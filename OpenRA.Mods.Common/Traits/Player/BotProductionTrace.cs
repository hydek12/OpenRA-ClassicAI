#region Copyright & License Information
/*
 * Copyright (c) The OpenRA Developers and Contributors
 * This file is part of OpenRA, which is free software. It is made
 * available to you under the terms of the GNU General Public License
 * as published by the Free Software Foundation, either version 3 of
 * the License, or (at your option) any later version. For more
 * information, see COPYING.
 */
#endregion

using System.Collections.Generic;

namespace OpenRA.Mods.Common.Traits
{
	sealed class BotProductionTrace(int id, string queue, string item, string name, bool isBuilding, int cost, int queuedAt)
	{
		public const int SampleInterval = 25;

		public int Id { get; } = id;
		public string Queue { get; } = queue;
		public string Item { get; } = item;
		public string Name { get; } = name;
		public bool IsBuilding { get; } = isBuilding;
		public int Cost { get; } = cost;
		public int QueuedAt { get; } = queuedAt;
		public int? StartedAt { get; private set; }
		public int? ReadyAt { get; private set; }
		public int? CompletedAt { get; private set; }
		public int? CancelledAt { get; private set; }
		public string CancellationReason { get; private set; }
		public int CashPaid { get; private set; }
		public int OrePaid { get; private set; }
		public int CashRefunded { get; private set; }
		public int OreRefunded { get; private set; }
		public List<Payment> Payments { get; } = [];
		public List<FundingWait> FundingWaits { get; } = [];
		public List<PauseChange> Pauses { get; } = [];

		int? firstPendingPaymentTick;
		int pendingCash;
		int pendingOre;

		internal void Start(int tick) { StartedAt = tick; }
		internal void Ready(int tick) { ReadyAt = tick; }
		internal void Complete(int tick) { CompletedAt = tick; }
		internal void Pause(int tick, bool paused) { Pauses.Add(new PauseChange(tick, paused)); }

		internal void Paid(int tick, int cash, int ore)
		{
			ResumeFunding(tick);
			if (cash == 0 && ore == 0)
				return;

			CashPaid += cash;
			OrePaid += ore;
			firstPendingPaymentTick ??= tick;
			pendingCash += cash;
			pendingOre += ore;
		}

		internal void FlushPayments(int sampleTick)
		{
			if (firstPendingPaymentTick is not int firstTick)
				return;

			Payments.Add(new Payment(firstTick, sampleTick, pendingCash, pendingOre));
			firstPendingPaymentTick = null;
			pendingCash = 0;
			pendingOre = 0;
		}

		internal void WaitForFunds(int tick, int required, long available)
		{
			if (FundingWaits.Count == 0 || FundingWaits[^1].EndTick != null)
				FundingWaits.Add(new FundingWait(tick, null, required, available));
		}

		void ResumeFunding(int tick)
		{
			if (FundingWaits.Count > 0 && FundingWaits[^1].EndTick == null)
				FundingWaits[^1] = FundingWaits[^1] with { EndTick = tick };
		}

		internal void Cancel(int tick, string reason, int cash, int ore)
		{
			ResumeFunding(tick);
			CancelledAt = tick;
			CancellationReason = reason;
			CashRefunded = cash;
			OreRefunded = ore;
		}

		internal sealed record Payment(int FirstTick, int Tick, int Cash, int Ore);
		internal sealed record FundingWait(int StartTick, int? EndTick, int Required, long Available);
		internal sealed record PauseChange(int Tick, bool Paused);
	}
}
