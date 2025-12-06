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
  
  // First, try to build a map of grid columns to dates by finding date headers
  const dateMap = buildDateMap();
  console.log('Date map:', dateMap);
  
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
    console.warn('No event elements found with any selector. Trying generic search...');
    // Try finding elements with aria-label that look like events
    const allElements = document.querySelectorAll('[aria-label]');
    const possibleEvents: Element[] = [];
    allElements.forEach(el => {
      const label = el.getAttribute('aria-label') || '';
      // Look for time patterns in aria-label
      if (label.match(/\d{1,2}:\d{2}\s*(am|pm)/i)) {
        possibleEvents.push(el);
      }
    });
    console.log('Found potential events by aria-label:', possibleEvents.length);
    eventElements = possibleEvents as any;
  }
  
  if (!eventElements) {
    console.log('No events found');
    return events;
  }
  
  console.log('Processing event elements:', eventElements.length);
  
  eventElements.forEach((element, index) => {
    try {
      const event = parseEventElement(element as HTMLElement, dateMap);
      if (event) {
        const eventDate = new Date(event.date);
        eventDate.setHours(0, 0, 0, 0);
        
        console.log(`Event ${index}:`, {
          title: event.title,
          start: event.start.toISOString(),
          end: event.end.toISOString(),
          date: eventDate.toISOString(),
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
  
function parseEventElement(element: HTMLElement, dateMap: Map<number, Date>): CalendarEvent | null {
  return events;
}

function buildDateMap(): Map<number, Date> {
  const dateMap = new Map<number, Date>();
  
  // Look for date headers in the calendar
  // These are typically in elements with specific classes or data attributes
  const dateHeaders = document.querySelectorAll('[data-datekey], [data-date-label], .date-label, [role="columnheader"]');
  
  dateHeaders.forEach((header, index) => {
    const dateText = header.textContent?.trim();
    const dataDate = header.getAttribute('data-datekey') || header.getAttribute('data-date');
    
    console.log(`Date header ${index}:`, dateText, 'data-date:', dataDate);
    
    // Try to parse the date from text content
    if (dateText) {
      // Look for patterns like "Mon 12/9", "Monday, December 9", etc.
      const dateMatch = dateText.match(/(\d{1,2})\/(\d{1,2})|([A-Za-z]+)\s+(\d{1,2})/);
      if (dateMatch) {
        let date: Date;
        if (dateMatch[1]) {
          // M/D format
          const month = parseInt(dateMatch[1]) - 1;
          const day = parseInt(dateMatch[2]);
          date = new Date(new Date().getFullYear(), month, day);
        } else {
          // Month name + day
          const monthMap: {[key: string]: number} = {
            'jan': 0, 'january': 0, 'feb': 1, 'february': 1, 'mar': 2, 'march': 2,
            'apr': 3, 'april': 3, 'may': 4, 'jun': 5, 'june': 5,
            'jul': 6, 'july': 6, 'aug': 7, 'august': 7, 'sep': 8, 'september': 8,
            'oct': 9, 'october': 9, 'nov': 10, 'november': 10, 'dec': 11, 'december': 11
          };
          const monthNum = monthMap[dateMatch[3].toLowerCase()];
          const day = parseInt(dateMatch[4]);
          date = new Date(new Date().getFullYear(), monthNum, day);
        }
        
        // Store with grid column as key
        const gridColumn = window.getComputedStyle(header as HTMLElement).gridColumn;
        if (gridColumn) {
          const colNum = parseInt(gridColumn);
          dateMap.set(colNum, date);
        }
      }
    }
  });
  
  return dateMap;
}

function parseEventElement(element: HTMLElement): CalendarEvent | null {
  try {
    // Extract title from span
    const titleSpan = element.querySelector('span[data-text]') || 
                     element.querySelector('[role="button"] span') ||
                     element.querySelector('span');
    
    if (!titleSpan) {
      console.log('No title span found');
      return null;
    }
    
    const fullText = titleSpan.textContent?.trim() || '';
    console.log('Event text:', fullText);
    
    // Parse title and time from text (e.g., "Meeting, 11am" or "Meeting, 11:30am")
    let title = fullText;
    let timeText = '';
    
    // Check if time is in the title
    const timeInTitle = fullText.match(/,\s*(\d{1,2}):?(\d{2})?\s*(am|pm)/i);
    if (timeInTitle) {
      // Split title from time
      const parts = fullText.split(',');
      title = parts[0].trim();
      timeText = parts.slice(1).join(',').trim();
      console.log('Extracted title:', title, 'time:', timeText);
    }
    
    // Get the event's position to determine date and time
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const top = parseInt(style.top || '0');
    const height = parseInt(style.height || '0');
    
    // Try to find the date from the grid column or parent
    let eventDate = new Date();
    
    // First, try to get date from the grid column using our date map
    const style = window.getComputedStyle(element);
    const gridColumn = style.gridColumn || style.gridColumnStart;
    if (gridColumn && dateMap.size > 0) {
      const colNum = parseInt(gridColumn);
      const mappedDate = dateMap.get(colNum);
      if (mappedDate) {
        eventDate = mappedDate;
        console.log('Found date from grid column', colNum, '->', eventDate.toDateString());
      }
    }
    
    // If still no date, look for parent with date info
    if (!eventDate || isNaN(eventDate.getTime()) || eventDate.getFullYear() < 2000) {
      let current: HTMLElement | null = element;
      while (current) {
        // Look for data-date or similar attributes that might have actual dates
        const attrs = ['data-date', 'data-day', 'aria-label'];
        for (const attr of attrs) {
          const value = current.getAttribute(attr);
          if (value && value.match(/\d{1,2}\/\d{1,2}/)) {
            const match = value.match(/(\d{1,2})\/(\d{1,2})/);
            if (match) {
              const month = parseInt(match[1]) - 1;
              const day = parseInt(match[2]);
              eventDate = new Date(new Date().getFullYear(), month, day);
              console.log('Found date from attribute:', value, '->', eventDate.toDateString());
              break;
            }
          }
        }
        if (eventDate && eventDate.getFullYear() >= 2000) break;
        current = current.parentElement;
      }
    }
    
    // Calculate time from position (Google Calendar uses pixels for time)
    // Typically each hour is about 42-48 pixels
    const pixelsPerHour = 42;
    const startMinutes = Math.floor(top / pixelsPerHour * 60);
    const durationMinutes = Math.floor(height / pixelsPerHour * 60);
    
    // Default to 9am if we can't calculate
    let startHour = 9;
    let startMin = 0;
    
    // Try to parse time from the title text if we found it
    if (timeText) {
      const timeMatch = timeText.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)/i);
      if (timeMatch) {
        startHour = parseInt(timeMatch[1]);
        startMin = parseInt(timeMatch[2] || '0');
        const period = timeMatch[3].toLowerCase();
        if (period === 'pm' && startHour !== 12) startHour += 12;
        if (period === 'am' && startHour === 12) startHour = 0;
      }
    } else if (startMinutes > 0) {
      // Use calculated time from position
      startHour = Math.floor(startMinutes / 60);
      startMin = startMinutes % 60;
    }
    
    // Create start time
    const start = new Date(eventDate);
    start.setHours(startHour, startMin, 0, 0);
    
    // Create end time (default to 1 hour if we can't determine)
    const endTime = new Date(start);
    if (durationMinutes > 0 && durationMinutes < 480) { // Sanity check (less than 8 hours)
      endTime.setMinutes(endTime.getMinutes() + durationMinutes);
    } else {
      endTime.setHours(endTime.getHours() + 1); // Default 1 hour
    }
    
    const result = {
      title,
      start,
      end: endTime,
      date: eventDate
    };
    
    console.log('Successfully parsed event:', result);
    return result;
  } catch (error) {
    console.error('Error parsing event element:', error);
    return null;
  }
}

function convertTo24Hour(hour: number, meridiem: string): number {
  const period = meridiem.toUpperCase();
  if (period === 'PM' && hour !== 12) {
    return hour + 12;
  }
  if (period === 'AM' && hour === 12) {
    return 0;
  }
  return hour;
}

// Signal that content script is ready
console.log('Calendar Availability content script loaded');
