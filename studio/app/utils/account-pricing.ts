import { Path } from "../constant";

export function accountPricingPath(model = "") {
  const query = new URLSearchParams();
  if (model) query.set("model", model);
  const search = query.toString();
  return `${Path.Pricing}${search ? `?${search}` : ""}`;
}
