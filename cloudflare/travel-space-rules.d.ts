export type TripStatus = "planning" | "upcoming" | "ongoing" | "completed" | "cancelled";
export type CompanionType = "solo" | "couple" | "family" | "friends" | "group";
export type TripType = "vacation" | "business" | "family-tour" | "educational" | "adventure" | "religious" | "other";
export type BudgetScope = "none" | "personal" | "group";
export type TaskStatus = "todo" | "in_progress" | "done" | "skipped";
export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type BookingCategory = "flight" | "bus" | "train" | "hotel" | "car_rental" | "activity" | "other";
export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled" | "refunded";
export type PaymentStatus = "unpaid" | "partial" | "paid" | "refunded";
export type TravellerRole = "owner" | "editor" | "expense_contributor" | "viewer";
export type DocumentCategory = "passport" | "visa" | "national_id" | "driving_licence" | "insurance" | "ticket" | "hotel_confirmation" | "permit" | "other";
export type ExploreStatus = "want_to_visit" | "planned" | "visited";
export type ExploreKind = "destination" | "attraction" | "restaurant" | "stay" | "place";
export type MemoryType = "photo" | "audio" | "journal";

export const TRIP_STATUSES: readonly TripStatus[];
export const COMPANION_TYPES: readonly CompanionType[];
export const TRIP_TYPES: readonly TripType[];
export const BUDGET_SCOPES: readonly BudgetScope[];
export const DEFAULT_BUDGET_CATEGORIES: readonly { name: string; color: string }[];
export const TRAVEL_CURRENCIES: readonly string[];
export const CURRENCY_SYMBOLS: Readonly<Record<string, string>>;
export const TASK_STATUSES: readonly TaskStatus[];
export const KANBAN_COLUMNS: readonly ("todo" | "in_progress" | "done")[];
export const TASK_PRIORITIES: readonly TaskPriority[];
export const BOOKING_CATEGORIES: readonly BookingCategory[];
export const BOOKING_STATUSES: readonly BookingStatus[];
export const PAYMENT_STATUSES: readonly PaymentStatus[];
export const TRAVELLER_ROLES: readonly TravellerRole[];
export const DOCUMENT_CATEGORIES: readonly DocumentCategory[];
export const EXPLORE_STATUSES: readonly ExploreStatus[];
export const EXPLORE_KINDS: readonly ExploreKind[];
export const MEMORY_TYPES: readonly MemoryType[];

export interface CuratedDestination {
  name: string;
  city: string;
  country: string;
  placeType: "country" | "city" | "place";
  latitude: number | null;
  longitude: number | null;
}

export const CURATED_DESTINATIONS: readonly CuratedDestination[];

export class TravelValidationError extends Error {
  status: number;
  constructor(message: string, status?: number);
}

export function isValidDate(value: unknown): boolean;
export function isValidTime(value: unknown): boolean;
export function addCalendarDays(dateStr: string, delta: number): string;
export function tripDurationDays(startDate: string, endDate: string): number;
export function generateTripDays(startDate: string, endDate: string): { dayNumber: number; date: string }[];
export function normalizeCurrency(code: unknown, fallback?: string): string;
export function currencyDecimals(currency: string): number;
export function currencyFactor(currency: string): number;
export function toMinor(value: unknown, currency?: string): number;
export function fromMinor(minor: number, currency?: string): number;
export function formatTravelMoney(amount: number | string, currency?: string): string;
export function splitEqualMinor(totalMinor: number, count: number): number[];
export function convertSharesProportionally(sharesMinor: number[], expenseTotalMinor: number, tripTotalMinor: number): number[];
export type TravelRouteMode = "driving" | "walking" | "cycling";

export interface ParsedMapCoordinatesResult {
  ok: boolean;
  latitude?: number;
  longitude?: number;
  labelHint?: string;
  source?: string;
  isShortLink?: boolean;
  extractedQuery?: string;
  message?: string;
}

export function isValidCoordinatePair(latitude: unknown, longitude: unknown): boolean;
export function roundCoordinate(value: number): number;
export function formatCoordinatePair(latitude: number, longitude: number, decimals?: number): string;
export function formatCoordinateStopLabel(latitude: number, longitude: number, index?: number): string;
export function parseCoordinateInput(rawInput: string): { latitude: number; longitude: number } | null;
export function parseGoogleMapsInput(rawInput: string): ParsedMapCoordinatesResult;
export function buildGoogleMapsPlaceUrl(latitude: number, longitude: number): string;
export function buildGoogleMapsDirectionsUrl(
  points: ReadonlyArray<{ latitude: number; longitude: number }>,
  travelMode?: TravelRouteMode | "bicycling",
): string;

export function searchCuratedDestinations(query: string): CuratedDestination[];
export function sanitizeTripDestinations(list: unknown): Array<{
  id?: string;
  latitude: number;
  longitude: number;
  orderIndex: number;
}>;
export function sanitizeInitialTasks(
  list: unknown,
  options?: { startDate?: string; endDate?: string },
): Array<{
  title: string;
  description: string;
  priority: TaskPriority;
  dueDate: string | null;
  scheduledDate: string | null;
  assigneeIndex: number | null;
  assignedTravellerId: string | null;
}>;
export function sanitizeTripInput(input: unknown, options?: { partial?: boolean }): any;
export function computeContributionSummary(contributions: unknown[], currency?: string): any;
export function sanitizeBudgetCategories(categories: unknown[], plannedBudgetMinor: number, currency?: string): any;
export function normalizeExpenseInput(input: unknown, trip: any, validTravellerIds?: string[]): any;
export function computeTravellerBalances(travellers: any[], expenses: any[], settlements: any[], primaryCurrency?: string): {
  balances: Array<{
    travellerId: string;
    fullName: string;
    totalPaid: number;
    personalSpent: number;
    totalShare: number;
    settlementsPaid: number;
    settlementsReceived: number;
    netMinor: number;
    netBalance: number;
    owesMinor: number;
    owes: number;
    shouldReceiveMinor: number;
    shouldReceive: number;
    settled: boolean;
  }>;
  suggestedSettlements: Array<{
    fromTravellerId: string;
    fromName: string;
    toTravellerId: string;
    toName: string;
    amountMinor: number;
    amount: number;
    currency: string;
  }>;
};
export function computeTripBudgetOverview(params: {
  trip: any;
  travellers?: any[];
  categories?: any[];
  contributions?: any[];
  expenses?: any[];
  settlements?: any[];
}): any;
export function detectScheduleOverlaps(items: any[]): {
  overlappingIds: string[];
  conflicts: Array<{
    date: string;
    firstId: string;
    firstTitle: string;
    secondId: string;
    secondTitle: string;
  }>;
};
export function canRolePerform(role: TravellerRole | null | undefined, action: string): boolean;
