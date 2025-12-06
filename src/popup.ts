import { AvailabilityCalculator, Settings, DayAvailability, CalendarEvent } from './calendar';

// DOM elements
const notCalendarSection = document.getElementById('not-calendar-section') as HTMLDivElement;
const mainContent = document.getElementById('main-content') as HTMLDivElement;
const statusContainer = document.getElementById('status-container') as HTMLDivElement;
const openCalendarButton = document.getElementById('open-calendar-button') as HTMLButtonElement;
const generateButton = document.getElementById('generate-button') as HTMLButtonElement;
const copyButton = document.getElementById('copy-button') as HTMLButtonElement;
const availabilityOutput = document.getElementById('availability-output') as HTMLDivElement;

// Settings inputs
const startDateInput = document.getElementById('start-date') as HTMLInputElement;
const endDateInput = document.getElementById('end-date') as HTMLInputElement;
const meetingLengthInput = document.getElementById('meeting-length') as HTMLInputElement;
const workStartInput = document.getElementById('work-start') as HTMLInputElement;
const workEndInput = document.getElementById('work-end') as HTMLInputElement;

// Day checkboxes
const dayCheckboxes = [
  document.getElementById('exclude-sunday') as HTMLInputElement,
  document.getElementById('exclude-monday') as HTMLInputElement,
  document.getElementById('exclude-tuesday') as HTMLInputElement,
  document.getElementById('exclude-wednesday') as HTMLInputElement,
  document.getElementById('exclude-thursday') as HTMLInputElement,
  document.getElementById('exclude-friday') as HTMLInputElement,
  document.getElementById('exclude-saturday') as HTMLInputElement,
];

// State
let currentAvailabilityText = '';

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  initializeDates();
  await loadSettings();
  await checkCalendarTab();
  setupEventListeners();
});

function initializeDates(): void {
  const today = new Date();
  const nextWeek = new Date(today);
  nextWeek.setDate(today.getDate() + 7);

  startDateInput.value = formatDateForInput(today);
  endDateInput.value = formatDateForInput(nextWeek);
}

function formatDateForInput(date: Date): string {
  return date.toISOString().split('T')[0];
}

async function checkCalendarTab(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (tab?.url?.includes('calendar.google.com')) {
      showMainContent();
    } else {
      showNotCalendarSection();
    }
  } catch (error) {
    showNotCalendarSection();
  }
}

function showNotCalendarSection(): void {
  notCalendarSection.classList.remove('hidden');
  mainContent.classList.add('hidden');
}

function showMainContent(): void {
  notCalendarSection.classList.add('hidden');
  mainContent.classList.remove('hidden');
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    // Try to ping the content script first
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
  } catch (error) {
    // Content script not loaded, inject it manually
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      // Give it a moment to initialize
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (injectError) {
      console.error('Failed to inject content script:', injectError);
      throw new Error('Could not load calendar reader. Try refreshing the page.');
    }
  }
}

function setupEventListeners(): void {
  openCalendarButton.addEventListener('click', handleOpenCalendar);
  generateButton.addEventListener('click', handleGenerate);
  copyButton.addEventListener('click', handleCopy);

  // Save settings on change
  [startDateInput, endDateInput, meetingLengthInput, workStartInput, workEndInput].forEach(input => {
    input.addEventListener('change', saveSettings);
  });

  dayCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', saveSettings);
  });
}

async function handleOpenCalendar(): Promise<void> {
  await chrome.tabs.create({ url: 'https://calendar.google.com' });
  window.close();
}

async function handleGenerate(): Promise<void> {
  try {
    generateButton.disabled = true;
    generateButton.textContent = 'Generating...';
    availabilityOutput.innerHTML = '<div class="loading">Reading calendar events...</div>';
    availabilityOutput.classList.remove('empty');
    copyButton.disabled = true;

    // Get settings
    const settings = getSettings();

    // Validate dates
    if (new Date(settings.startDate) > new Date(settings.endDate)) {
      throw new Error('Start date must be before end date');
    }

    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab?.id || !tab.url?.includes('calendar.google.com')) {
      throw new Error('Please open Google Calendar to use this extension');
    }

    // Ensure content script is injected
    await ensureContentScript(tab.id);

    // Send message to content script to extract events
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, {
        action: 'getEvents',
        startDate: settings.startDate,
        endDate: settings.endDate
      });
    } catch (error) {
      throw new Error('Could not connect to calendar page. Try refreshing the page and try again.');
    }

    if (!response.success) {
      throw new Error(response.error || 'Failed to read calendar events');
    }

    const events: CalendarEvent[] = response.events;

    // Calculate availability
    const calculator = new AvailabilityCalculator(settings);
    const availability = calculator.calculate(events);

    // Display results
    displayAvailability(availability);
    copyButton.disabled = availability.length === 0;

    if (availability.length === 0) {
      showStatus('No availability found in the selected date range', 'info');
    } else {
      showStatus(`Found availability on ${availability.length} day(s)`, 'success');
    }
  } catch (error) {
    showStatus(`Error: ${(error as Error).message}`, 'error');
    availabilityOutput.innerHTML = '<div class="empty">Failed to generate availability</div>';
    availabilityOutput.classList.add('empty');
    copyButton.disabled = true;
  } finally {
    generateButton.disabled = false;
    generateButton.textContent = 'Generate Availability';
  }
}

function getSettings(): Settings {
  const excludedDays: number[] = [];
  dayCheckboxes.forEach((checkbox, index) => {
    if (checkbox.checked) {
      excludedDays.push(index);
    }
  });

  return {
    meetingLength: parseInt(meetingLengthInput.value) || 30,
    excludedDays,
    startDate: startDateInput.value,
    endDate: endDateInput.value,
    workStart: workStartInput.value,
    workEnd: workEndInput.value,
  };
}

function displayAvailability(availability: DayAvailability[]): void {
  if (availability.length === 0) {
    availabilityOutput.innerHTML = '<div class="empty">No available time slots found</div>';
    availabilityOutput.classList.add('empty');
    currentAvailabilityText = '';
    return;
  }

  availabilityOutput.classList.remove('empty');
  
  const lines: string[] = [];
  const ul = document.createElement('ul');
  ul.className = 'availability-list';

  availability.forEach(day => {
    const dateStr = formatDateDisplay(day.date);
    const timesStr = day.slots
      .map(slot => `${formatTime(slot.start)} to ${formatTime(slot.end)}`)
      .join(', ');
    
    const line = `${dateStr}: ${timesStr}`;
    lines.push(`- ${line}`);

    const li = document.createElement('li');
    li.textContent = `- ${line}`;
    ul.appendChild(li);
  });

  availabilityOutput.innerHTML = '';
  availabilityOutput.appendChild(ul);
  currentAvailabilityText = lines.join('\n');
}

function formatDateDisplay(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatTime(date: Date): string {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';
  
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 should be 12
  
  const minutesStr = minutes === 0 ? '' : `:${minutes.toString().padStart(2, '0')}`;
  
  return `${hours}${minutesStr}${ampm}`;
}

async function handleCopy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(currentAvailabilityText);
    copyButton.textContent = 'Copied!';
    setTimeout(() => {
      copyButton.textContent = 'Copy to Clipboard';
    }, 2000);
  } catch (error) {
    showStatus('Failed to copy to clipboard', 'error');
  }
}

function showStatus(message: string, type: 'error' | 'success' | 'info'): void {
  const statusDiv = document.createElement('div');
  statusDiv.className = `status-message ${type}`;
  statusDiv.textContent = message;
  
  statusContainer.innerHTML = '';
  statusContainer.appendChild(statusDiv);

  // Auto-hide after 5 seconds
  setTimeout(() => {
    statusDiv.remove();
  }, 5000);
}

// Settings persistence
const SETTINGS_KEY = 'calendarAvailabilitySettings';

async function saveSettings(): Promise<void> {
  const settings = getSettings();
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
}

async function loadSettings(): Promise<void> {
  try {
    const result = await chrome.storage.sync.get(SETTINGS_KEY);
    const settings = result[SETTINGS_KEY] as Settings | undefined;

    if (settings) {
      if (settings.meetingLength) meetingLengthInput.value = settings.meetingLength.toString();
      if (settings.workStart) workStartInput.value = settings.workStart;
      if (settings.workEnd) workEndInput.value = settings.workEnd;
      
      // Reset all checkboxes first
      dayCheckboxes.forEach(checkbox => checkbox.checked = false);
      
      // Set excluded days
      if (settings.excludedDays) {
        settings.excludedDays.forEach(day => {
          if (dayCheckboxes[day]) {
            dayCheckboxes[day].checked = true;
          }
        });
      }
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}
