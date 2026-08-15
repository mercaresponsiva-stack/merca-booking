import { dateOnlyToUtc } from "@/lib/booking/datetime";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export type HotelRateForPricing = {
  startDate: Date;
  endDate: Date;

  weekdayPrice: unknown;
  weekendPrice: unknown;
};

export function calculateHotelNights(checkIn: string, checkOut: string) {
  const startDate = dateOnlyToUtc(checkIn);

  const endDate = dateOnlyToUtc(checkOut);

  const numberOfNights = Math.round(
    (endDate.getTime() - startDate.getTime()) / MILLISECONDS_PER_DAY,
  );

  if (numberOfNights < 1) {
    throw new Error("INVALID_NUMBER_OF_NIGHTS");
  }

  return numberOfNights;
}

export function calculateHotelPrice(
  checkIn: string,
  checkOut: string,
  rates: HotelRateForPricing[],
) {
  const startDate = dateOnlyToUtc(checkIn);

  const numberOfNights = calculateHotelNights(checkIn, checkOut);

  const nightlyPrices: number[] = [];

  let total = 0;

  for (let night = 0; night < numberOfNights; night++) {
    const date = new Date(startDate.getTime() + night * MILLISECONDS_PER_DAY);

    const rate = rates.find(
      (currentRate) =>
        date >= currentRate.startDate && date <= currentRate.endDate,
    );

    if (!rate) {
      throw new Error("RATE_NOT_AVAILABLE");
    }

    const day = date.getUTCDay();

    const isWeekend = day === 0 || day === 6;

    const nightlyPrice = Number(
      isWeekend ? rate.weekendPrice : rate.weekdayPrice,
    );

    if (!Number.isFinite(nightlyPrice) || nightlyPrice < 0) {
      throw new Error("INVALID_RATE_PRICE");
    }

    nightlyPrices.push(nightlyPrice);

    total += nightlyPrice;
  }

  return {
    numberOfNights,
    nightlyPrices,
    total,
  };
}
