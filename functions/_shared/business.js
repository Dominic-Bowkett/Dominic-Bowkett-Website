// Platform (Dom's) business identity used on invoices and emails. Override via wrangler [vars].
export function platform(env = {}) {
  return {
    name: env.BIZ_NAME || "Dominic Bowkett",
    legalName: env.BIZ_LEGAL_NAME || "EMS-2 Ltd trading as Dominic Bowkett",
    address: env.BIZ_ADDRESS || "128 City Road, London, EC1V 2NX",
    companyNo: env.BIZ_COMPANY_NO || "11235441",
    vatNo: env.BIZ_VAT_NO || "GB476836441",
    email: env.BIZ_EMAIL || "info@dominicbowkett.com",
    site: env.BIZ_SITE || "www.dominicbowkett.com",
    feeVatRate: Number(env.FEE_VAT_RATE ?? 20),
    reviewUrl: env.REVIEW_URL || "", // when set, the paid-confirmation email invites the client to rate the service
  };
}
