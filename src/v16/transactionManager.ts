import { call } from "../messageFactory";
import { VCP } from "../vcp";

const METER_VALUES_INTERVAL_SEC = 60;
const CHARGING_POWER_KW = parseFloat(process.env["CHARGING_POWER_KW"] ?? "22"); // Charging power in kW (configurable via env)

interface TransactionState {
  transactionId: number;
  meterValue: number;
  startedAt: Date;
  connectorId: number;
  meterValuesTimer?: NodeJS.Timer;
}

export class TransactionManager {
  transactions: Map<string, TransactionState> = new Map();

  startTransaction(
    vcp: VCP,
    transactionId: number,
    connectorId: number
  ) {
    const meterValuesTimer = setInterval(() => {
      vcp.send(
        call("MeterValues", {
          connectorId: connectorId,
          transactionId: transactionId,
          meterValue: [
            {
              timestamp: new Date(),
              sampledValue: [
                {
                  value: (this.getMeterValue(transactionId) * CHARGING_POWER_KW / 3600).toFixed(3),
                  measurand: "Energy.Active.Import.Register",
                  unit: "kWh",
                },
              ],
            },
          ],
        })
      );
    }, METER_VALUES_INTERVAL_SEC * 1000);
    this.transactions.set(transactionId.toString(), {
      transactionId: transactionId,
      meterValue: 0,
      startedAt: new Date(),
      connectorId: connectorId,
      meterValuesTimer: meterValuesTimer,
    });
  }

  stopTransaction(transactionId: number) {
    const transaction = this.transactions.get(transactionId.toString());
    if (transaction && transaction.meterValuesTimer) {
      clearInterval(transaction.meterValuesTimer);
    }
    this.transactions.delete(transactionId.toString());
  }

  getMeterValue(transactionId: number) {
    const transaction = this.transactions.get(transactionId.toString());
    if (!transaction) {
      return 0;
    }
    return (new Date().getTime() - transaction.startedAt.getTime()) / 1000;
  }

  getMeterValueWh(transactionId: number): number {
    const seconds = this.getMeterValue(transactionId);
    // Convert seconds to Wh: (seconds / 3600) * kW * 1000
    return Math.floor((seconds / 3600) * CHARGING_POWER_KW * 1000);
  }
}

export const transactionManager = new TransactionManager();
