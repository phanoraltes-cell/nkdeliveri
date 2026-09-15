import { reportFailedDeliveryCreditViolations } from "./check-failed-delivery-credit.mjs";
process.exit(reportFailedDeliveryCreditViolations() > 0 ? 1 : 0);
