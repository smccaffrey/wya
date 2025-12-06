// Content script that runs on calendar.google.com
// Extracts calendar events from the DOM

interface CalendarEvent {
  title: string;
  start: Date;
  end: Date;
  date: Date;
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ success: true });
    return true;
  }
  
  if (request.action === 'getEvents') {
    try {
      const events = extractEventsFromDOM(request.startDate, request.endDate);
      console.log('Extracted events:', events);
      sendResponse({ success: true, events });
    } catch (error) {
      console.error('Error extracting events:', error);
      sendResponse({ success: false, error: (error as Error).message });
    }
  }
  return true;
});

function extractEventsFromDOM(startDate: string, endDate: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  
  console.log(`Searching for events between ${start.toDateString()} and ${end.toDateString()}`);
  
  // Try multiple selectors to find events
  const selectors = [
    '[data-eventid]',
    '[data-draggable-id]',
    '[role="button"][jslog*="event"]',
    '[data-eventchip]',
    'div[data-eventid]',
    'div[data-draggable-id]',
    '[jsname][data-eventid]'
  ];
  
  let eventElements: NodeListOf<Element> | null = null;
  for (const selector of selectors) {
    const found = document.querySelectorAll(selector);
    console.log(`Selector "${selector}" found:`, found.length, 'elements');
    if (found.length > 0) {
      eventElements = found;
      break;
    }
  }
  
  if (!eventElements || eventElements.length === 0) {
    console.warn('No event elements found with any selector');
    return events;
  }
  
  console.log('Processing event elements:', eventElements.length);
  
  eventElements.forEach((element, index) => {
    try {
      const event = parseEventElement(element as HTMLElement);
      if (event) {
        const eventDate = new Date(event.date);
        eventDate.setHours(0, 0, 0, 0);
        
        console.log(`Event ${index}:`, {
          title: event.title,
          start: event.start.toISOString(),
          end: event.end.toISOString(),
          date: eventDate.toDateString(),
          inRange: eventDate >= start && eventDate <= end
        });
        
        if (eventDate >= start && eventDate <= end) {
          events.push(event);
        }
      }
    } catch (error) {
      console.warn('Failed to parse event:', error);
    }
  });
  
  console.log('Total events extracted:', events.length);
  return events;
}

function buildDateMap(): Map<string, Date> {
  const dateMap = new Map<string, Date>();
  
  // Find date headers with data-datekey attributes
  // These contain date info we can parse from their text content
  const headers = document.querySelectorAll('[data-datekey]');
  console.log(`Found ${headers.length} elements with data-datekey`);
  
  headers.forEach((header) => {
    const dateText = header.textContent?.trim();
    const dataDateKey = header.getAttribute('data-datekey');
    
    if (!dataDateKey) return;
    
    console.log(`Datekey ${dataDateKey}: "${dateText}"`);
    
    if (!dateText) return;
    
    // Look for patterns like "Monday, December 8" or "December 8" or "2 events, Monday, December 8"
    // Match: weekday, month day or just month day
    const dateMatch = dateText.match(/([A-Za-z]+),\s+([A-Za-z]+)\s+(\d{1,2})|([A-Za-z]+)\s+(\d{1,2})/i);
    if (dateMatch) {
      console.log(`  Matched groups:`, dateMatch);
      const monthMap: {[key: string]: number} = {
        'jan': 0, 'january': 0, 'feb': 1, 'february': 1, 'mar': 2, 'march': 2,
        'apr': 3, 'april': 3, 'may': 4, 'jun': 5, 'june': 5,
        'jul': 6, 'july': 6, 'aug': 7, 'august': 7, 'sep': 8, 'september': 8,
        'oct': 9, 'october': 9, 'nov': 10, 'november': 10, 'dec': 11, 'december': 11
      };
      
      // Check which group matched
      let monthStr: string;
      let day: number;
      
      if (dateMatch[2]) {
        // Pattern: "weekday, month day"
        monthStr = dateMatch[2];
        day = parseInt(dateMatch[3]);
        console.log(`  Pattern 1: weekday="${dateMatch[1]}", month="${monthStr}", day=${day}`);
      } else {
        // Pattern: "month day"
        monthStr = dateMatch[4];
        day = parseInt(dateMatch[5]);
        console.log(`  Pattern 2: month="${monthStr}", day=${day}`);
      }
      
      const monthNum = monthMap[monthStr.toLowerCase()];
      
      if (monthNum !== undefined) {
        // Determine year based on month (handle year rollover)
        const now = new Date();
        let year = now.getFullYear();
        
        // If the month is before current month and we're near year end, it's next year
        if (monthNum < now.getMonth() && now.getMonth() >= 11) {
          year++;
        }
        
        const date = new Date(year, monthNum, day);
        dateMap.set(dataDateKey, date);
        console.log(`  -> Mapped to ${date.toDateString()}`);
      } else {
        console.log(`  -> Month "${monthStr}" not recognized`);
      }
    } else {
      console.log(`  -> No date pattern matched`);
    }
  });
  
  console.log(`Built date map with ${dateMap.size} entries`);
  return dateMap;
}

function parseEventElement(element: HTMLElement): CalendarEvent | null {
  try {
    // Look for the XuJrye div which contains full event details like:
    // "11am to 11:30am, Akkio Interview - Recruiter Screen, Sam McCaffrey, Accepted, No location, December 8, 2025"
    const detailsDiv = element.querySelector('.XuJrye');
    const fullDetails = detailsDiv?.textContent?.trim() || '';
    
    console.log('Event details:', fullDetails);
    
    if (!fullDetails) {
      console.log('No event details found');
      return null;
    }
    
    // Parse the details format: "TIME, TITLE, OWNER, STATUS, LOCATION, DATE"
    const parts = fullDetails.split(',').map(p => p.trim());
    
    if (parts.length < 2) {
      console.log('Not enough parts in event details');
      return null;
    }
    
    // Extract time (first part): "11am to 11:30am" or "2pm to 3pm" or "2 – 3pm"
    const timePart = parts[0];
    // Match various formats: "11am to 11:30am", "2pm to 3pm", "2 – 3pm", "2:30pm to 3:45pm"
    const timeMatch = timePart.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)\s+(?:to|–|-)\s+(\d{1,2}):?(\d{2})?\s*(am|pm)/i);
    
    let startHour = 9;
    let startMin = 0;
    let endHour = 10;
    let endMin = 0;
    
    if (timeMatch) {
      startHour = parseInt(timeMatch[1]);
      startMin = parseInt(timeMatch[2] || '0');
      const startPeriod = timeMatch[3].toLowerCase();
      
      endHour = parseInt(timeMatch[4]);
      endMin = parseInt(timeMatch[5] || '0');
      const endPeriod = timeMatch[6].toLowerCase();
      
      // Convert to 24-hour format
      if (startPeriod === 'pm' && startHour !== 12) startHour += 12;
      if (startPeriod === 'am' && startHour === 12) startHour = 0;
      if (endPeriod === 'pm' && endHour !== 12) endHour += 12;
      if (endPeriod === 'am' && endHour === 12) endHour = 0;
      
      console.log(`Parsed time: ${startHour}:${startMin} to ${endHour}:${endMin}`);
    } else {
      console.log(`Could not parse time from: "${timePart}"`);
    }
    
    // Extract title (second part)
    const title = parts[1] || 'Untitled Event';
    
    // Extract date by searching the entire string for pattern "December 8, 2025"
    // Don't rely on splitting by comma since locations can have commas
    const dateMatch = fullDetails.match(/([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
    
    let eventDate: Date | null = null;
    
    if (dateMatch) {
      console.log(`Date match found: ${dateMatch[0]}`);
      const monthMap: {[key: string]: number} = {
        'jan': 0, 'january': 0, 'feb': 1, 'february': 1, 'mar': 2, 'march': 2,
        'apr': 3, 'april': 3, 'may': 4, 'jun': 5, 'june': 5,
        'jul': 6, 'july': 6, 'aug': 7, 'august': 7, 'sep': 8, 'september': 8,
        'oct': 9, 'october': 9, 'nov': 10, 'november': 10, 'dec': 11, 'december': 11
      };
      
      const monthNum = monthMap[dateMatch[1].toLowerCase()];
      const day = parseInt(dateMatch[2]);
      const year = parseInt(dateMatch[3]);
      
      if (monthNum !== undefined) {
        eventDate = new Date(year, monthNum, day);
        console.log(`Parsed date: ${eventDate.toDateString()}`);
      } else {
        console.log(`Month "${dateMatch[1]}" not recognized`);
      }
    } else {
      console.log(`Date regex did not match in: "${fullDetails}"`);
    }
    
    // If we couldn't parse the date, use today as fallback
    if (!eventDate) {
      console.warn('Could not parse date from event details, using today');
      eventDate = new Date();
      eventDate.setHours(0, 0, 0, 0);
    }
    
    // Create start and end Date objects
    const start = new Date(eventDate);
    start.setHours(startHour, startMin, 0, 0);
    
    const end = new Date(eventDate);
    end.setHours(endHour, endMin, 0, 0);
    
    const result = {
      title,
      start,
      end,
      date: eventDate
    };
    
    console.log('Successfully parsed event:', result);
    return result;
  } catch (error) {
    console.error('Error parsing event element:', error);
    return null;
  }
}

console.log('Calendar Availability content script loaded');
