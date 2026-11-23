using System.Text.Json.Nodes;
using ComodoRandevuHazir.Domain;

namespace ComodoRandevuHazir.Application;

/// <summary>Ön yüz DB biçimindeki veriyi (ör. demo verisi) içe aktarır; aynı id'ler güncellenir.</summary>
public class ImportService(IRecordStore records, ICredentialStore credentials, IPasswordHasher hasher)
{
    public async Task<int> ImportAsync(JsonObject db, IReadOnlyDictionary<string, (string Email, string Password)>? logins, CancellationToken ct)
    {
        var rows = new List<RecordRow>();
        foreach (var name in Collections.All)
        {
            if (db[name] is not JsonArray items) continue;
            foreach (var item in items.OfType<JsonObject>())
            {
                var id = item["id"]?.GetValue<string>() ?? throw new ValidationException($"{name}: id alanı eksik.");
                var tenantId = Collections.ScopedBySelf(name) ? id : item["tenantId"]?.GetValue<string>();
                rows.Add(new RecordRow(name, id, tenantId, item.ToJsonString()));
            }
        }
        await records.UpsertManyAsync(rows, ct);

        foreach (var (userId, (email, password)) in logins ?? new Dictionary<string, (string, string)>())
            await credentials.SetAsync(new Credential(userId, AuthService.NormalizeEmail(email), hasher.Hash(password)), ct);
        return rows.Count;
    }
}
