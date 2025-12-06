// Simplified calendar interfaces - no API needed
interface CalendarEvent {
  title: string;
  start: Date;
  end: Date;
  date: Date;
}

interface Settings {
  meetingLength: number;
  excludedDays: number[];
  startDate: string;
  endDate: string;
  workStart: string;
  workEnd: string;
}

interface TimeSlot {
  start: Date;
  end: Date;
}

interface DayAvailability {
  date: Date;
  slots: TimeSlot[];
}

class AvailabilityCalculator {
  private settings: Settings;

  constructor(settings: Settings) {
    this.settings = settings;
  }

  calculate(events: CalendarEvent[]): DayAvailability[] {
    const availability: DayAvailability[] = [];
    const startDate = new Date(this.settings.startDate);
    const endDate = new Date(this.settings.endDate);

    // Iterate through each day in the range
    for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
      const currentDate = new Date(date);
      
      // Skip if day is excluded
      if (this.settings.excludedDays.includes(currentDate.getDay())) {
        continue;
      }

      const dayStart = this.parseTimeOnDate(currentDate, this.settings.workStart);
      const dayEnd = this.parseTimeOnDate(currentDate, this.settings.workEnd);

      // Get events for this day
      const dayEvents = this.getEventsForDay(events, currentDate);

      // Calculate free slots
      const freeSlots = this.calculateFreeSlots(dayStart, dayEnd, dayEvents);

      // Filter by minimum meeting length
      const validSlots = freeSlots.filter(slot => {
        const durationMinutes = (slot.end.getTime() - slot.start.getTime()) / (1000 * 60);
        return durationMinutes >= this.settings.meetingLength;
      });

      if (validSlots.length > 0) {
        availability.push({
          date: currentDate,
          slots: validSlots,
        });
      }
    }

    return availability;
  }

  private parseTimeOnDate(date: Date, timeString: string): Date {
    const [hours, minutes] = timeString.split(':').map(Number);
    const result = new Date(date);
    result.setHours(hours, minutes, 0, 0);
    return result;
  }

  private getEventsForDay(events: CalendarEvent[], date: Date): CalendarEvent[] {
    return events.filter(event => {
      const eventStart = new Date(event.start);
      const eventEnd = new Date(event.end);
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      // Event overlaps with this day
      return eventStart < dayEnd && eventEnd > dayStart;
    });
  }

  private calculateFreeSlots(dayStart: Date, dayEnd: Date, events: CalendarEvent[]): TimeSlot[] {
    const slots: TimeSlot[] = [];
    
    // Sort events by start time
    const sortedEvents = events
      .map(e => ({
        start: new Date(e.start),
        end: new Date(e.end),
      }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    let currentTime = dayStart;

    for (const event of sortedEvents) {
      // If there's a gap before this event
      if (currentTime < event.start) {
        slots.push({
          start: new Date(currentTime),
          end: new Date(event.start),
        });
      }
      
      // Move current time to end of this event
      if (event.end > currentTime) {
        currentTime = event.end;
      }
    }

    // Add remaining time after last event
    if (currentTime < dayEnd) {
      slots.push({
        start: new Date(currentTime),
        end: new Date(dayEnd),
      });
    }

    return slots;
  }
}

export { AvailabilityCalculator, Settings, DayAvailability, TimeSlot, CalendarEvent };
