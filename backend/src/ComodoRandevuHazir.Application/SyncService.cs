using System.Text;
using System.Text.Json;
using ComodoRandevuHazir.Domain;

namespace ComodoRandevuHazir.Application;

/// <summary>Kiracının tüm verisini ön yüzün DB biçiminde (sürüm + 20 koleksiyon) tek JSON olarak üretir.</summary>
public class SyncService(IRecordStore records)
{
    public const int DbVersion = 3;

    public async Task<string> SnapshotAsync(Identity who, CancellationToken ct)
    {
        var rows = await records.ListAsync(who.Role == "platform" ? null : who.TenantId ?? throw new ForbiddenException("Kiracı bilgisi yok."), ct);
        var byCollection = rows.GroupBy(r => r.Collection).ToDictionary(g => g.Key, g => g.ToList());

        using var ms = new MemoryStream();
        using (var w = new Utf8JsonWriter(ms))
        {
            w.WriteStartObject();
            w.WriteNumber("version", DbVersion);
            foreach (var name in Collections.All)
            {
                w.WriteStartArray(name);
                foreach (var r in byCollection.GetValueOrDefault(name) ?? []) w.WriteRawValue(r.Data, skipInputValidation: true);
                w.WriteEndArray();
            }
            w.WriteEndObject();
        }
        return Encoding.UTF8.GetString(ms.ToArray());
    }
}
