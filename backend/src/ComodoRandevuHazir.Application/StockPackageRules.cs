using System.Text.Json.Nodes;
using static ComodoRandevuHazir.Application.RecordRules;

namespace ComodoRandevuHazir.Application;

/// <summary>
/// Stok: ürün miktarı yalnız aynı anda yazılan stok hareketleri kadar değişir; hareketler değiştirilemez/silinemez (denetim kaydı).
/// Paket: müşteri paketi yalnız kapanan bir adisyonun paket satışıyla oluşur; seans yalnız kapanan adisyondaki
/// "paketten" satırları kadar düşer; süresi dolmuş paketten ve kalanından fazla seans kullanılamaz.
/// (Demo/eski verideki ürün stokları hareketsiz girilmiş olabilir; bu yüzden kural toplam değil fark üzerinedir.)
/// </summary>
public class StockPackageRules(IRecordStore records)
{
    private const string StockMismatch = "Stok miktarı stok hareketleriyle uyuşmuyor.";

    public async Task CheckAsync(IReadOnlyList<PendingWrite> ups, IReadOnlyList<PendingDelete> dels, CancellationToken ct)
    {
        if (dels.Any(d => d.Key.Collection == "stockMoves")) throw new ConflictException("Stok hareketleri silinemez.");
        CheckStock(ups);
        await CheckPackagesAsync(ups, ct);
    }

    private static void CheckStock(IReadOnlyList<PendingWrite> ups)
    {
        foreach (var m in ups.Where(w => w.Collection == "stockMoves" && w.Old is not null))
            if (!JsonNode.DeepEquals(m.Old, m.Data)) throw new ConflictException("Stok hareketleri değiştirilemez.");

        var moved = ups.Where(w => w.Collection == "stockMoves" && w.Old is null)
            .GroupBy(w => Str(w.Data, "productId")!).ToDictionary(g => g.Key, g => g.Sum(w => Int(w.Data, "qty") ?? 0));
        var products = ups.Where(w => w.Collection == "products").ToDictionary(w => w.Id);

        foreach (var p in products.Values)
        {
            var before = p.Old is null ? 0 : Int(p.Old, "stock") ?? 0;
            if (Int(p.Data, "stock") != before + moved.GetValueOrDefault(p.Id)) throw new ValidationException(StockMismatch);
        }
        // Hareketi yazılıp miktarı güncellenmeyen ürün de uyuşmazlıktır.
        if (moved.Any(m => m.Value != 0 && !products.ContainsKey(m.Key))) throw new ValidationException(StockMismatch);
    }

    private async Task CheckPackagesAsync(IReadOnlyList<PendingWrite> ups, CancellationToken ct)
    {
        // Bu batch'te kapanan adisyonlar (kapalıyken değişmeyenler hariç).
        var closing = ups.Where(w => w.Collection == "tickets" && Str(w.Data, "status") == "closed" && Str(w.Old ?? [], "status") != "closed").ToList();
        static IEnumerable<JsonObject> Lines(PendingWrite t, string kind) => (t.Data["lines"] as JsonArray ?? []).OfType<JsonObject>().Where(l => Str(l, "kind") == kind);

        // Paketten kullanılan seanslar: (paket, hizmet) → adet
        var used = closing.SelectMany(t => Lines(t, "package_use").Select(l => (Ticket: t, Cp: Str(l, "refId")!, Service: Str(l, "serviceId") ?? "", Qty: Int(l, "qty") ?? 0))).ToList();
        var cps = ups.Where(w => w.Collection == "customerPackages").ToDictionary(w => w.Id);

        foreach (var cp in cps.Values)
        {
            var remaining = cp.Data["remaining"] as JsonObject ?? throw new ValidationException("Paket bilgileri geçersiz.");
            foreach (var (_, v) in remaining)
                if (v is not JsonValue n || !n.TryGetValue<int>(out var left)) throw new ValidationException("Paket bilgileri geçersiz.");
                else if (left < 0) throw new ValidationException("Pakette bu hizmet için kalan seans yok.");
            RequireDate(cp.Data, "expiresOn");

            if (cp.Old is null)
            {
                var sale = closing.FirstOrDefault(t => t.Id == Str(cp.Data, "ticketId"));
                if (sale is null || Str(sale.Data, "customerId") != Str(cp.Data, "customerId")
                    || !Lines(sale, "package_sale").Any(l => Str(l, "refId") == Str(cp.Data, "packageDefId")))
                    throw new ValidationException("Paket yalnız adisyonla satılabilir.");
                continue;
            }
            var oldRemaining = cp.Old["remaining"] as JsonObject ?? [];
            foreach (var service in remaining.Select(p => p.Key).Union(oldRemaining.Select(p => p.Key)))
            {
                var drop = (Int(oldRemaining, service) ?? 0) - (Int(remaining, service) ?? 0);
                if (drop != used.Where(u => u.Cp == cp.Id && u.Service == service).Sum(u => u.Qty))
                    throw new ValidationException("Paket seansı yalnız adisyonla düşülebilir.");
            }
        }

        foreach (var group in used.GroupBy(u => (u.Cp, u.Service)))
        {
            var ticket = group.First().Ticket;
            var cp = cps.TryGetValue(group.Key.Cp, out var w) ? w.Old : await LoadAsync(group.Key.Cp, ticket.TenantId, ct);
            if (cp is null || Str(cp, "customerId") != Str(ticket.Data, "customerId")) throw new ValidationException("Paket bulunamadı.");
            if (string.CompareOrdinal(Str(cp, "expiresOn"), Str(ticket.Data, "date")) < 0) throw new ValidationException("Paketin süresi dolmuş.");
            if ((Int(cp["remaining"] as JsonObject ?? [], group.Key.Service) ?? 0) < group.Sum(u => u.Qty)) throw new ValidationException("Pakette bu hizmet için kalan seans yok.");
            if (!cps.ContainsKey(group.Key.Cp)) throw new ValidationException("Paket seansları adisyonla uyuşmuyor.");
        }
    }

    private async Task<JsonObject?> LoadAsync(string id, string? tenantId, CancellationToken ct) =>
        await records.GetAsync("customerPackages", id, ct) is { } r && r.TenantId == tenantId ? JsonNode.Parse(r.Data)!.AsObject() : null;
}
