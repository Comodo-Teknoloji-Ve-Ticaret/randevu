using System.Text.Json.Nodes;
using ComodoRandevuHazir.Domain;
using static ComodoRandevuHazir.Application.RecordRules;

namespace ComodoRandevuHazir.Application;

/// <summary>Kayda hazırlanan bir değişiklik (kiracıya bağlanmış, yetkisi doğrulanmış).</summary>
public record PendingWrite(string Collection, string Id, string? TenantId, JsonObject Data, JsonObject? Old);

public record PendingDelete(RecordKey Key, string? TenantId, JsonObject Old);

/// <summary>
/// Kasa kuralları (ön yüz application/cashService.ts): kapalı adisyon değişmez, ödeme toplamı aşamaz,
/// kapanış için tam ödeme, veresiye/paket satışı için müşteri, tahsilat açık borcu aşamaz,
/// kapatılmış gün dondurulur ve yalnız sahip açar; gün sonu beklenen nakdi sunucu hesaplar.
/// </summary>
public class CashRules(IRecordStore records)
{
    public const string DayLocked = "Bu günün kasası kapatılmış. Salon sahibi açmadan işlem yapılamaz.";
    private static readonly string[] CashMethods = ["cash", "card", "transfer"];

    public async Task CheckAsync(Identity who, IReadOnlyList<PendingWrite> ups, IReadOnlyList<PendingDelete> dels, CancellationToken ct)
    {
        var ctx = new Batch(records, ups, dels);
        foreach (var w in ups)
        {
            switch (w.Collection)
            {
                case "tickets": await TicketAsync(ctx, w, ct); break;
                case "debtCollections": await MoneyMoveAsync(ctx, w, ct); break;
                case "expenses": await MoneyMoveAsync(ctx, w, ct); break;
                case "dayCloses": await DayCloseAsync(ctx, who, w, ct); break;
            }
        }
        foreach (var d in dels)
        {
            switch (d.Key.Collection)
            {
                case "tickets" when Str(d.Old, "status") == "closed":
                    throw new ConflictException("Kapalı adisyon silinemez.");
                case "dayCloses" when who.Role is not ("owner" or "platform"):
                    throw new ForbiddenException("Kasayı yalnızca salon sahibi açabilir.");
                case "expenses" or "debtCollections" when await ctx.IsLockedAsync(d.TenantId!, Str(d.Old, "branchId"), Str(d.Old, "date"), ct):
                    throw new ConflictException(DayLocked);
            }
        }
        await DebtBalancesAsync(ctx, ct);
    }

    private static async Task TicketAsync(Batch ctx, PendingWrite w, CancellationToken ct)
    {
        var t = w.Data;
        if (w.Old is not null && Str(w.Old, "status") == "closed")
        {
            if (!JsonNode.DeepEquals(w.Old, t)) throw new ConflictException("Kapalı adisyon değiştirilemez.");
            return;
        }
        RequireDate(t);
        var status = Str(t, "status");
        if (status is not ("open" or "closed")) throw new ValidationException("Geçersiz adisyon durumu.");

        var lines = (t["lines"] as JsonArray ?? []).Select(n => n as JsonObject ?? throw new ValidationException("Adisyon satırı geçersiz.")).ToList();
        var amounts = lines.Select(l =>
        {
            if (Str(l, "kind") is not { } kind || !Money.LineKinds.Contains(kind) || Int(l, "qty") is not > 0 || Int(l, "unitPrice") is not >= 0)
                throw new ValidationException("Adisyon satırı geçersiz.");
            return new TicketLineAmount(Int(l, "qty")!.Value, Int(l, "unitPrice")!.Value, ParseDiscount(l["discount"]));
        }).ToList();
        var payments = (t["payments"] as JsonArray ?? []).Select(n =>
        {
            if (n is not JsonObject p || Str(p, "method") is not { } m || !Money.PaymentMethods.Contains(m) || Int(p, "amount") is not > 0)
                throw new ValidationException("Ödeme geçersiz.");
            return new PaymentAmount(m, Int(p, "amount")!.Value);
        }).ToList();
        var tip = t["tip"] is null ? 0 : Int(t, "tip") is { } tp && tp >= 0 ? tp : throw new ValidationException("Bahşiş geçersiz.");

        var totals = Money.Totals(amounts, ParseDiscount(t["discount"]), tip, payments);
        if (totals.Remaining < 0) throw new ValidationException("Ödeme tutarı adisyon toplamını aşıyor.");

        var closing = status == "closed";
        var hasCustomer = Str(t, "customerId") is { Length: > 0 };
        if (closing)
        {
            if (totals.Remaining != 0) throw new ValidationException("Adisyonda ödenmemiş tutar var.");
            if (totals.Debt > 0 && !hasCustomer) throw new ValidationException("Veresiye için adisyona müşteri seçin.");
            if (lines.Any(l => Str(l, "kind") == "package_sale") && !hasCustomer) throw new ValidationException("Paket satışı için adisyona müşteri seçin.");
        }
        var paymentsChanged = !JsonNode.DeepEquals(w.Old?["payments"] ?? new JsonArray(), t["payments"] ?? new JsonArray());
        if ((closing || paymentsChanged) && await ctx.IsLockedAsync(w.TenantId!, Str(t, "branchId"), Str(t, "date"), ct))
            throw new ConflictException(DayLocked);
    }

    private static Discount? ParseDiscount(JsonNode? node)
    {
        if (node is null) return null;
        if (node is not JsonObject d || Int(d, "value") is not { } value) throw new ValidationException("İndirim geçersiz.");
        return Str(d, "type") switch
        {
            "percent" when value is >= 0 and <= 100 => new Discount("percent", value),
            "amount" when value >= 0 => new Discount("amount", value),
            _ => throw new ValidationException("İndirim geçersiz."),
        };
    }

    /// <summary>Borç tahsilatı ve gider: pozitif tutar, geçerli yöntem, kapalı güne yazılamaz.</summary>
    private static async Task MoneyMoveAsync(Batch ctx, PendingWrite w, CancellationToken ct)
    {
        RequireDate(w.Data);
        if (Int(w.Data, "amount") is not > 0) throw new ValidationException("Tutar sıfırdan büyük olmalı.");
        if (Str(w.Data, "method") is not { } m || !CashMethods.Contains(m)) throw new ValidationException("Ödeme yöntemi geçersiz.");
        if (w.Collection == "debtCollections" && Str(w.Data, "customerId") is not { Length: > 0 }) throw new ValidationException("Tahsilat için müşteri gerekli.");
        if (w.Old is not null && JsonNode.DeepEquals(w.Old, w.Data)) return;
        if (await ctx.IsLockedAsync(w.TenantId!, Str(w.Data, "branchId"), Str(w.Data, "date"), ct)) throw new ConflictException(DayLocked);
        if (w.Old is not null && await ctx.IsLockedAsync(w.TenantId!, Str(w.Old, "branchId"), Str(w.Old, "date"), ct)) throw new ConflictException(DayLocked);
    }

    private static async Task DayCloseAsync(Batch ctx, Identity who, PendingWrite w, CancellationToken ct)
    {
        RequireDate(w.Data);
        var wasLocked = w.Old?["locked"]?.GetValue<bool>() == true;
        var locked = w.Data["locked"]?.GetValue<bool>() == true;
        if (wasLocked && !locked && who.Role is not ("owner" or "platform")) throw new ForbiddenException("Kasayı yalnızca salon sahibi açabilir.");
        if (locked) w.Data["expectedCash"] = await ctx.ExpectedCashAsync(w.TenantId!, Str(w.Data, "branchId"), Str(w.Data, "date")!, ct);
    }

    /// <summary>Tahsilat eklenen her müşteri için: toplam tahsilat ≤ kapalı adisyonlardaki veresiye.</summary>
    private static async Task DebtBalancesAsync(Batch ctx, CancellationToken ct)
    {
        var touched = ctx.Ups.Where(w => w.Collection == "debtCollections" && (w.Old is null || !JsonNode.DeepEquals(w.Old["amount"], w.Data["amount"])))
            .Select(w => (w.TenantId!, Str(w.Data, "customerId")!)).Distinct();
        foreach (var (tenantId, customerId) in touched)
        {
            var debt = (await ctx.MergedAsync(tenantId, "tickets", "customerId", customerId, ct))
                .Where(t => Str(t, "status") == "closed")
                .Sum(t => (t["payments"] as JsonArray ?? []).OfType<JsonObject>().Where(p => Str(p, "method") == "debt").Sum(p => Int(p, "amount") ?? 0));
            var collected = (await ctx.MergedAsync(tenantId, "debtCollections", "customerId", customerId, ct)).Sum(c => Int(c, "amount") ?? 0);
            if (collected > debt) throw new ValidationException("Tahsilat, müşterinin açık borcundan fazla olamaz.");
        }
    }

    /// <summary>Veritabanındaki kayıtlar + bu batch'teki eklemeler/güncellemeler − silinenler.</summary>
    private sealed class Batch(IRecordStore records, IReadOnlyList<PendingWrite> ups, IReadOnlyList<PendingDelete> dels)
    {
        public IReadOnlyList<PendingWrite> Ups => ups;

        public async Task<List<JsonObject>> MergedAsync(string tenantId, string collection, string field, string value, CancellationToken ct)
        {
            var byId = (await records.ListByFieldAsync(tenantId, collection, field, value, ct)).ToDictionary(r => r.Id, r => JsonNode.Parse(r.Data)!.AsObject());
            foreach (var w in ups.Where(w => w.Collection == collection && w.TenantId == tenantId))
                if (Str(w.Data, field) == value) byId[w.Id] = w.Data; else byId.Remove(w.Id);
            foreach (var d in dels.Where(d => d.Key.Collection == collection)) byId.Remove(d.Key.Id);
            return [.. byId.Values];
        }

        public async Task<bool> IsLockedAsync(string tenantId, string? branchId, string? date, CancellationToken ct) =>
            date is not null && (await MergedAsync(tenantId, "dayCloses", "date", date, ct))
                .Any(d => Str(d, "branchId") == branchId && d["locked"]?.GetValue<bool>() == true);

        /// <summary>Ön yüz dayCash().expectedCash: nakit ödemeler + nakit tahsilat − nakit gider.</summary>
        public async Task<int> ExpectedCashAsync(string tenantId, string? branchId, string date, CancellationToken ct)
        {
            bool Here(JsonObject o) => Str(o, "branchId") == branchId;
            var cashIn = (await MergedAsync(tenantId, "tickets", "date", date, ct)).Where(t => Here(t) && Str(t, "status") == "closed")
                .Sum(t => (t["payments"] as JsonArray ?? []).OfType<JsonObject>().Where(p => Str(p, "method") == "cash").Sum(p => Int(p, "amount") ?? 0));
            var collected = (await MergedAsync(tenantId, "debtCollections", "date", date, ct)).Where(c => Here(c) && Str(c, "method") == "cash").Sum(c => Int(c, "amount") ?? 0);
            var spent = (await MergedAsync(tenantId, "expenses", "date", date, ct)).Where(e => Here(e) && Str(e, "method") == "cash").Sum(e => Int(e, "amount") ?? 0);
            return cashIn + collected - spent;
        }
    }
}
