/** Missing operating costs cannot establish net yield; losses stay negative. */
export function rentalReturns(price?: number, rent?: number, costs?: number) {
  if (!Number.isFinite(price) || !price || price <= 0 || !Number.isFinite(rent) || rent == null || rent < 0) {
    return { grossYield: null, capRate: null };
  }
  return {
    grossYield: rent * 12 / price * 100,
    capRate: costs == null || !Number.isFinite(costs) || costs < 0 ? null : (rent * 12 - costs) / price * 100,
  };
}
