import type { CycleSettings } from '@/types';

export type PeriodPrediction = {
  startDate: string;
  endDate: string;
  cycleNumber: number;
};

export type DateComfort = 'comfortable' | 'moderate' | 'uncomfortable' | 'unknown';

export type DateRating = {
  date: string;
  rating: number; // 0-5
  comfortLevel: DateComfort;
  reason: string;
};

/**
 * Calculate predicted period dates based on cycle settings.
 * The algorithm projects forward from last_period_start using average_cycle_length.
 * Returns predictions that overlap the given date range.
 */
export function calculatePeriodPredictions(
  settings: CycleSettings,
  rangeStart: Date,
  rangeEnd: Date,
  maxCycles = 12
): PeriodPrediction[] {
  if (!settings.tracking_enabled || !settings.last_period_start) {
    return [];
  }

  const cycleLength = settings.average_cycle_length || 28;
  const periodLength = settings.period_length || 5;
  const baseDate = new Date(settings.last_period_start);
  const predictions: PeriodPrediction[] = [];

  // Go back up to 3 cycles before the base date to catch ongoing/recent periods
  for (let i = -3; i < maxCycles; i++) {
    const cycleStart = new Date(baseDate);
    cycleStart.setDate(cycleStart.getDate() + i * cycleLength);
    const cycleEnd = new Date(cycleStart);
    cycleEnd.setDate(cycleEnd.getDate() + periodLength - 1);

    // Check if this period overlaps with the requested range
    if (cycleEnd >= rangeStart && cycleStart <= rangeEnd) {
      predictions.push({
        startDate: cycleStart.toISOString().split('T')[0],
        endDate: cycleEnd.toISOString().split('T')[0],
        cycleNumber: i + 1,
      });
    }
  }

  return predictions;
}

/**
 * Calculate the comfort level of a specific date for a user with given cycle settings.
 * - During period: uncomfortable
 * - Days right before period (PMS): moderate
 * - Ovulation and mid-cycle: comfortable
 * - Unknown if tracking disabled
 */
export function calculateDateComfort(settings: CycleSettings, date: Date): DateComfort {
  if (!settings.tracking_enabled || !settings.last_period_start) {
    return 'unknown';
  }

  const cycleLength = settings.average_cycle_length || 28;
  const periodLength = settings.period_length || 5;
  const baseDate = new Date(settings.last_period_start);

  // Calculate days since last period start, mod cycle length
  const diffMs = date.getTime() - baseDate.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  const dayInCycle = ((diffDays % cycleLength) + cycleLength) % cycleLength;

  // During period (days 0 to periodLength-1)
  if (dayInCycle < periodLength) {
    return 'uncomfortable';
  }

  // PMS zone: last 3 days before next period
  if (dayInCycle >= cycleLength - 3) {
    return 'moderate';
  }

  // Ovulation zone: around day 14 (can cause mild discomfort)
  const ovulationDay = Math.floor(cycleLength / 2);
  if (Math.abs(dayInCycle - ovulationDay) <= 1) {
    return 'moderate';
  }

  return 'comfortable';
}

function comfortToScore(comfort: DateComfort): number {
  switch (comfort) {
    case 'comfortable': return 5;
    case 'moderate': return 3;
    case 'uncomfortable': return 0;
    default: return -1; // unknown
  }
}

/**
 * Find the best meeting dates within a range, given multiple users' cycle settings.
 * Only considers users with tracking_enabled and privacy_level !== 'hidden'.
 * Returns dates sorted by rating (best first).
 */
export function findBestMeetingDates(
  allSettings: CycleSettings[],
  rangeStart: Date,
  rangeEnd: Date,
  maxResults = 10
): DateRating[] {
  const activeSettings = allSettings.filter(
    (s) => s.tracking_enabled && s.privacy_level !== 'hidden'
  );

  const dateRatings: DateRating[] = [];
  const totalUsers = activeSettings.length || 1;

  const cursor = new Date(rangeStart);
  while (cursor <= rangeEnd) {
    let totalScore = 0;
    let knownUsers = 0;

    for (const settings of activeSettings) {
      const comfort = calculateDateComfort(settings, cursor);
      const score = comfortToScore(comfort);
      if (score >= 0) {
        totalScore += score;
        knownUsers++;
      }
    }

    // Average score across known users, scaled to 0-5
    const avgScore = knownUsers > 0 ? totalScore / knownUsers : 5;
    const rating = Math.round(avgScore * 2) / 2; // round to nearest 0.5

    let comfortLevel: DateComfort = 'comfortable';
    let reason = '';

    if (knownUsers === 0) {
      comfortLevel = 'comfortable';
      reason = 'Нет данных о цикле участниц — дата свободна по умолчанию';
    } else if (avgScore >= 4.5) {
      comfortLevel = 'comfortable';
      reason = 'Подходит большинству участниц группы';
    } else if (avgScore >= 3) {
      comfortLevel = 'moderate';
      reason = 'Средняя комфортность для группы';
    } else {
      comfortLevel = 'uncomfortable';
      reason = 'Неподходящее время для части участниц';
    }

    dateRatings.push({
      date: cursor.toISOString().split('T')[0],
      rating,
      comfortLevel,
      reason,
    });

    cursor.setDate(cursor.getDate() + 1);
  }

  dateRatings.sort((a, b) => b.rating - a.rating);
  return dateRatings.slice(0, maxResults);
}

/**
 * Check if a date falls within any predicted period.
 */
export function isDateInPeriod(settings: CycleSettings, date: Date): boolean {
  if (!settings.tracking_enabled || !settings.last_period_start) return false;
  const comfort = calculateDateComfort(settings, date);
  return comfort === 'uncomfortable';
}
