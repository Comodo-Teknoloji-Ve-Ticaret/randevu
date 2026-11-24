using System.Text.Json.Nodes;
using static ComodoRandevuHazir.Application.RecordRules;

namespace ComodoRandevuHazir.Application;

/// <summary>
/// Mesaj kaydı gönderim geçmişidir: değiştirilemez, silinemez. Mesajlar yalnız WhatsApp ile, salonun kendi
/// telefonundan elle gönderilir; sunucu kaydı tutar. Kayıt yalnız müşterinin kayıtlı numarasına yazılır
/// (istemcinin yazdığı numaraya asla). Hizmet mesajı (onay/hatırlatma/iptal) ileti izni, kampanya mesajı
/// (doğum günü/geri kazanım) ayrıca açık rıza ister.
/// </summary>
public class MessageRules(IRecordStore records)
{
    public async Task CheckAsync(IReadOnlyList<PendingWrite> ups, IReadOnlyList<PendingDelete> dels, CancellationToken ct)
    {
        if (dels.Any(d => d.Key.Collection == "messages")) throw new ConflictException("Gönderilmiş mesaj silinemez.");
        foreach (var m in ups.Where(w => w.Collection == "messages"))
        {
            if (m.Old is not null)
            {
                if (!JsonNode.DeepEquals(m.Old, m.Data)) throw new ConflictException("Gönderilmiş mesaj değiştirilemez.");
                continue;
            }
            var customer = Str(m.Data, "customerId") is { Length: > 0 } cid
                ? await CustomerAsync(cid, m.TenantId, ups, ct)
                : throw new ValidationException("Mesaj için müşteri gerekli.");
            if (customer is null) throw new ValidationException("Müşteri bulunamadı.");
            if (customer["consentSms"]?.GetValue<bool>() != true) throw new ValidationException("Müşterinin ileti izni yok.");
            var commercial = Str(m.Data, "kind") is "birthday" or "winback";
            if (commercial && customer["consentMarketing"]?.GetValue<bool>() != true)
                throw new ValidationException("Müşterinin kampanya mesajı için açık rızası yok.");
            m.Data["to"] = Str(customer, "phone") is { Length: > 0 } p ? p : throw new ValidationException("Müşterinin telefon numarası yok.");
            m.Data["status"] = "opened";
        }
    }

    private async Task<JsonObject?> CustomerAsync(string id, string? tenantId, IReadOnlyList<PendingWrite> ups, CancellationToken ct)
    {
        if (ups.FirstOrDefault(w => w.Collection == "customers" && w.Id == id) is { } inBatch) return inBatch.Data;
        return await records.GetAsync("customers", id, ct) is { } r && r.TenantId == tenantId ? JsonNode.Parse(r.Data)!.AsObject() : null;
    }
}
