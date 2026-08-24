import type { Expense, ExpenseParticipant } from '@/types';

export type MemberBalance = {
  userId: string;
  paidTotal: number;
  owesTotal: number;
  netBalance: number; // positive = owed money, negative = owes money
};

export type DebtSettlement = {
  fromUserId: string;
  toUserId: string;
  amount: number;
};

/**
 * Calculate each member's net balance from all expenses.
 * paidTotal = sum of all expenses they paid for
 * owesTotal = sum of all their share_amounts across expenses
 * netBalance = paidTotal - owesTotal (positive means they are owed)
 */
export function calculateBalances(
  expenses: Expense[],
  participants: ExpenseParticipant[]
): Map<string, MemberBalance> {
  const balances = new Map<string, MemberBalance>();

  for (const expense of expenses) {
    const paid = Number(expense.amount);
    const existing = balances.get(expense.paid_by) || {
      userId: expense.paid_by,
      paidTotal: 0,
      owesTotal: 0,
      netBalance: 0,
    };
    existing.paidTotal += paid;
    existing.netBalance = existing.paidTotal - existing.owesTotal;
    balances.set(expense.paid_by, existing);
  }

  for (const p of participants) {
    const share = Number(p.share_amount);
    const existing = balances.get(p.user_id) || {
      userId: p.user_id,
      paidTotal: 0,
      owesTotal: 0,
      netBalance: 0,
    };
    existing.owesTotal += share;
    existing.netBalance = existing.paidTotal - existing.owesTotal;
    balances.set(p.user_id, existing);
  }

  return balances;
}

/**
 * Minimize the number of transactions needed to settle all debts.
 * Uses a greedy approach: the person who owes the most pays the person who is owed the most.
 */
export function optimizeDebts(balances: Map<string, MemberBalance>): DebtSettlement[] {
  const creditors: { userId: string; amount: number }[] = [];
  const debtors: { userId: string; amount: number }[] = [];

  for (const balance of balances.values()) {
    const net = Math.round(balance.netBalance * 100) / 100;
    if (net > 0.01) {
      creditors.push({ userId: balance.userId, amount: net });
    } else if (net < -0.01) {
      debtors.push({ userId: balance.userId, amount: -net });
    }
  }

  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const settlements: DebtSettlement[] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const amount = Math.min(creditors[ci].amount, debtors[di].amount);
    const rounded = Math.round(amount * 100) / 100;

    if (rounded > 0.01) {
      settlements.push({
        fromUserId: debtors[di].userId,
        toUserId: creditors[ci].userId,
        amount: rounded,
      });
    }

    creditors[ci].amount -= amount;
    debtors[di].amount -= amount;

    if (creditors[ci].amount < 0.01) ci++;
    if (debtors[di].amount < 0.01) di++;
  }

  return settlements;
}

/**
 * Calculate equal shares for an expense split among N participants.
 */
export function calculateEqualShares(totalAmount: number, participantCount: number): number[] {
  if (participantCount === 0) return [];
  const baseShare = Math.floor((totalAmount / participantCount) * 100) / 100;
  const shares = Array(participantCount).fill(baseShare);
  const remainder = Math.round((totalAmount - baseShare * participantCount) * 100) / 100;
  if (remainder > 0) {
    shares[0] += remainder; // first person covers the rounding remainder
  }
  return shares;
}
