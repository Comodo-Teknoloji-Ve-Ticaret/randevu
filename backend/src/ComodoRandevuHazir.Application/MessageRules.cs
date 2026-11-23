using System.Text.Json.Nodes;
using static ComodoRandevuHazir.Application.RecordRules;

namespace ComodoRandevuHazir.Application;

/// <summary>
/// Mesaj kaydı gönderim geçmişidir: değiştirilemez, silinemez. SMS yalnız ileti izni olan müşteriye
/// ve yalnız müşterinin kayıtlı numarasına gider (istemcinin yazdığı numaraya asla). WhatsApp salonun
/// kendi telefonundan elle gönderildiği için yalnız kayıt tutulur.
/// </summary>
public class MessageRules(IRecordStore records, ISmsSender sms)
{
    public async Task<List<OutgoingSms>> CheckAsync(IReadOnlyList<PendingWrite> ups, IReadOnlyList<PendingDelete> dels, CancellationToken ct)
    {
        if (dels.Any(d => d.Key.Collection == "messages")) throw new ConflictException("Gönderilmiş mesaj silinemez.");
        var outgoing = new List<OutgoingSms>();
        foreach (var m in ups.Where(w => w.Collection == "messages"))
        {
            if (m.Old is not null)
            {
                if (!JsonNode.DeepEquals(m.Old, m.Data)) throw new ConflictException("Gönderilmiş mesaj değiştirilemez.");
                continue;
            }
            var channel = Str(m.Data, "channel");
            var customer = Str(m.Data, "customerId") is { Length: > 0 } cid ? await CustomerAsync(cid, m.TenantId, ups, ct) : null;
            if (channel == "whatsapp")
            {
                m.Data["status"] = "opened";
                if (customer is not null) m.Data["to"] = Str(customer, "phone");
                continue;
            }
            if (customer is null) throw new ValidationException("SMS için müşteri gerekli.");
            if (customer["consentSms"]?.GetValue<bool>() != true) throw new ValidationException("Müşterinin ileti izni yok.");
            var commercial = Str(m.Data, "kind") is "birthday" or "winback";
            if (commercial && customer["consentMarketing"]?.GetValue<bool>() != true)
                throw new ValidationException("Müşterinin kampanya mesajı için açık rızası yok.");
            var to = Str(customer, "phone") is { Length: > 0 } p ? p : throw new ValidationException("Müşterinin telefon numarası yok.");
            m.Data["to"] = to;
            m.Data["status"] = sms.LogStatus;
            outgoing.Add(new OutgoingSms(m.Id, m.TenantId, to, Str(m.Data, "body")!, Commercial: commercial));
        }
        return outgoing;
    }

    private async Task<JsonObject?> CustomerAsync(string id, string? tenantId, IReadOnlyList<PendingWrite> ups, CancellationToken ct)
    {
        if (ups.FirstOrDefault(w => w.Collection == "customers" && w.Id == id) is { } inBatch) return inBatch.Data;
        return await records.GetAsync("customers", id, ct) is { } r && r.TenantId == tenantId ? JsonNode.Parse(r.Data)!.AsObject() : null;
    }
}
