using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using ComodoRandevuHazir.Domain;

namespace ComodoRandevuHazir.Application;

/// <summary>
/// Ön yüzün değişikliklerini (eklenen/güncellenen/silinen kayıtlar) tek işlemde uygular.
/// Her kayıt kiracıya bağlanır; rol yetkisi, korunan alanlar ve kiracı içi başvurular doğrulanır.
/// </summary>
public partial class BatchService(IRecordStore records, CashRules cash, StockPackageRules stock, MessageRules messages, ISmsSender sms)
{
    public const int MaxOperations = 5000;
    private const string NoAccess = "Bu kayda erişim yetkiniz yok.";
    private const string NoPermission = "Bu işlem için yetkiniz yok.";

    [GeneratedRegex("^[A-Za-z0-9_.-]{1,80}$")]
    private static partial Regex IdPattern();

    /// <summary>Başvuru alanı → hedef koleksiyon ve hata mesajı.</summary>
    private static readonly Dictionary<string, (string Field, string Target, string Message)[]> References = new()
    {
        ["services"] = [("categoryId", "categories", "Kategori bulunamadı.")],
        ["staff"] = [("branchId", "branches", "Şube bulunamadı.")],
        ["appointments"] = [("staffId", "staff", "Personel bulunamadı."), ("branchId", "branches", "Şube bulunamadı."), ("customerId", "customers", "Müşteri bulunamadı.")],
        ["blocks"] = [("staffId", "staff", "Personel bulunamadı.")],
        ["colorCards"] = [("customerId", "customers", "Müşteri bulunamadı.")],
        ["messages"] = [("customerId", "customers", "Müşteri bulunamadı."), ("appointmentId", "appointments", "Randevu bulunamadı.")],
        ["stockMoves"] = [("productId", "products", "Ürün bulunamadı.")],
        ["customerPackages"] = [("customerId", "customers", "Müşteri bulunamadı."), ("packageDefId", "packageDefs", "Paket bulunamadı.")],
    };

    public async Task<int> ApplyAsync(Identity who, BatchRequest req, CancellationToken ct)
    {
        var upserts = req.Upserts ?? [];
        var deletes = req.Deletes ?? [];
        if (upserts.Count + deletes.Count > MaxOperations) throw new ValidationException($"Tek seferde en fazla {MaxOperations} değişiklik gönderilebilir.");

        var ups = upserts.Select(u => (u.Collection, Id: ValidId(u.Collection, u.Data?["id"]), Data: u.Data!)).ToList();
        var dels = deletes.Select(d => new RecordKey(d.Collection, ValidId(d.Collection, d.Id))).ToList();

        var existing = (await records.GetManyAsync([.. ups.Select(u => new RecordKey(u.Collection, u.Id)), .. dels], ct))
            .ToDictionary(r => new RecordKey(r.Collection, r.Id));
        var platform = who.Role == "platform";
        var me = platform ? null : await records.GetAsync("users", who.UserId, ct);
        var myStaffId = me is null ? null : JsonNode.Parse(me.Data)?["staffId"]?.GetValue<string>();

        var pending = new List<PendingWrite>();
        foreach (var (collection, id, data) in ups)
        {
            var old = existing.GetValueOrDefault(new RecordKey(collection, id));
            var oldData = old is null ? null : JsonNode.Parse(old.Data)!.AsObject();
            var tenantId = platform ? PlatformTenant(collection, id, data) : ScopeToCaller(who.TenantId!, collection, id, data, old);
            if (!platform) Authorize(who, myStaffId, collection, data, oldData);
            RecordRules.Validate(collection, data);
            pending.Add(new PendingWrite(collection, id, tenantId, data, oldData));
        }
        var pendingDeletes = new List<PendingDelete>();
        foreach (var key in dels)
        {
            if (!existing.TryGetValue(key, out var old)) continue; // zaten yok: silme idempotent
            var oldData = JsonNode.Parse(old.Data)!.AsObject();
            if (!platform)
            {
                if (old.TenantId != who.TenantId || key.Collection == "tenants") throw new ForbiddenException(NoAccess);
                if (key.Collection == "users" && key.Id == who.UserId) throw new ForbiddenException("Kendi hesabınızı silemezsiniz.");
                Authorize(who, myStaffId, key.Collection, null, oldData);
            }
            pendingDeletes.Add(new PendingDelete(key, old.TenantId, oldData));
        }

        List<RecordRow> Rows() => [.. pending.Select(w => new RecordRow(w.Collection, w.Id, w.TenantId, w.Data.ToJsonString()))];
        await CheckReferencesAsync(Rows(), ct); // önce "bulunamadı" hataları: en anlaşılır mesaj
        await cash.CheckAsync(who, pending, pendingDeletes, ct); // gün sonu beklenen nakdi burada yazılır
        await stock.CheckAsync(pending, pendingDeletes, ct);
        var outgoing = await messages.CheckAsync(pending, pendingDeletes, ct); // alıcı numarası burada müşteriden yazılır
        var rows = Rows();

        await CheckUniquePhonesAsync(rows, ct);
        await CheckUniqueSlugsAsync(rows, ct);
        await records.ApplyAsync(rows, dels, ct);
        // Kayıt kesinleştikten sonra gönder: reddedilen bir batch SMS göndermez.
        // Gerçek sağlayıcıda sonuç (iletildi / iletilemedi + neden) mesaj kaydına yazılır.
        foreach (var m in outgoing)
        {
            var result = await sms.SendAsync(m, ct);
            if (sms.LogStatus == "simulated" || rows.FirstOrDefault(r => r.Collection == "messages" && r.Id == m.MessageId) is not { } row) continue;
            var data = JsonNode.Parse(row.Data)!.AsObject();
            data["status"] = result.Ok ? "sent" : "failed";
            if (result.ProviderRef is not null) data["providerRef"] = result.ProviderRef;
            if (result.Error is not null) data["error"] = result.Error;
            await records.UpsertManyAsync([row with { Data = data.ToJsonString() }], ct);
        }
        return rows.Count + dels.Count;
    }

    private static string ValidId(string collection, JsonNode? id) =>
        ValidId(collection, id is JsonValue v && v.TryGetValue<string>(out var s) ? s : null);

    private static string ValidId(string collection, string? id)
    {
        if (!Collections.IsKnown(collection)) throw new ValidationException($"Bilinmeyen koleksiyon: {collection}");
        if (string.IsNullOrEmpty(id) || !IdPattern().IsMatch(id)) throw new ValidationException($"{collection}: geçersiz ya da eksik id.");
        return id;
    }

    private static string PlatformTenant(string collection, string id, JsonObject data)
    {
        if (Collections.ScopedBySelf(collection)) return id;
        return data["tenantId"] is JsonValue v && v.TryGetValue<string>(out var t) && t.Length > 0 ? t
            : throw new ValidationException($"{collection}/{id}: tenantId alanı gerekli.");
    }

    /// <summary>Salon kullanıcısı yalnız kendi kiracısına yazar; kiracı alanı sunucuda kesinleşir.</summary>
    private static string ScopeToCaller(string tenantId, string collection, string id, JsonObject data, RecordRow? old)
    {
        if (old is not null && old.TenantId != tenantId) throw new ForbiddenException(NoAccess);
        if (Collections.ScopedBySelf(collection))
        {
            if (id != tenantId) throw new ForbiddenException(NoAccess);
            return tenantId;
        }
        if (data["tenantId"] is JsonValue v && v.TryGetValue<string>(out var claimed) && claimed != tenantId) throw new ForbiddenException(NoAccess);
        data["tenantId"] = tenantId;
        return tenantId;
    }

    private static void Authorize(Identity who, string? myStaffId, string collection, JsonObject? data, JsonObject? old)
    {
        var role = who.Role;
        var changed = Changed(old, data);
        switch (collection)
        {
            case "tenants":
                if (data is null) throw new ForbiddenException(NoAccess);
                if (changed.Intersect(Permissions.PlatformOnlyTenantFields).Any())
                    throw new ForbiddenException("Lisans ve paket bilgileri yalnız Comodo tarafından değiştirilebilir.");
                if (Permissions.Can(role, "settings")) return;
                if (role == "reception" && changed.All(Permissions.ReceptionTenantFields.Contains)) return;
                throw new ForbiddenException(NoPermission);

            case "staff":
                if (Permissions.Can(role, "staff")) return;
                // Hizmetler ekranı, hizmeti yapan personeli işaretler (yalnız serviceIds).
                if (old is not null && data is not null && Permissions.Can(role, "services") && changed.All(f => f == "serviceIds")) return;
                throw new ForbiddenException(NoPermission);

            case "users":
                if (!Permissions.Can(role, "settings")) throw new ForbiddenException(NoPermission);
                if (data?["role"] is JsonValue r && r.TryGetValue<string>(out var newRole) && newRole is not ("owner" or "reception" or "staff"))
                    throw new ForbiddenException(NoPermission);
                return;

            case "appointments" or "blocks":
                if (!Permissions.Can(role, "calendar")) throw new ForbiddenException(NoPermission);
                if (Permissions.Can(role, "calendar.all")) return;
                // Personel yalnız kendi takvimine yazar.
                if (myStaffId is null || StaffOf(data) is { } n && n != myStaffId || StaffOf(old) is { } o && o != myStaffId)
                    throw new ForbiddenException(NoPermission);
                return;

            default:
                if (!Permissions.CanWrite(role, collection)) throw new ForbiddenException(NoPermission);
                return;
        }
    }

    private static string? StaffOf(JsonObject? o) => o?["staffId"] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    /// <summary>Eski ve yeni kayıt arasında değeri farklı olan üst düzey alanlar (tenantId hariç).</summary>
    private static HashSet<string> Changed(JsonObject? old, JsonObject? data)
    {
        if (old is null || data is null) return [.. (old ?? data ?? []).Select(p => p.Key).Where(k => k != "tenantId")];
        var keys = old.Select(p => p.Key).Union(data.Select(p => p.Key)).Where(k => k != "tenantId");
        return [.. keys.Where(k => !JsonNode.DeepEquals(old[k], data[k]))];
    }

    /// <summary>Bir salonda aynı telefonla iki müşteri olmaz (ön yüz de aynı kuralı uygular; eşzamanlı kayıtlara karşı sunucu güvencesi).</summary>
    private async Task CheckUniquePhonesAsync(List<RecordRow> rows, CancellationToken ct)
    {
        var customers = rows.Where(r => r.Collection == "customers")
            .Select(r => (r.Id, r.TenantId, Phone: JsonNode.Parse(r.Data)?["phone"] is JsonValue v && v.TryGetValue<string>(out var p) && p.Length > 0 ? p : null))
            .Where(x => x.Phone is not null && x.TenantId is not null).ToList();
        foreach (var dup in customers.GroupBy(c => (c.TenantId, c.Phone)).Where(g => g.Count() > 1))
            throw new ConflictException("Bu telefonla kayıtlı bir müşteri zaten var.");
        foreach (var (id, tenantId, phone) in customers)
            if ((await records.ListByFieldAsync(tenantId!, "customers", "phone", phone!, ct)).Any(r => r.Id != id))
                throw new ConflictException("Bu telefonla kayıtlı bir müşteri zaten var.");
    }

    private async Task CheckUniqueSlugsAsync(List<RecordRow> rows, CancellationToken ct)
    {
        foreach (var r in rows.Where(r => r.Collection == "tenants"))
            if (JsonNode.Parse(r.Data)?["slug"] is JsonValue v && v.TryGetValue<string>(out var slug) && slug.Length > 0
                && await records.FindTenantBySlugAsync(slug, ct) is { } other && other.Id != r.Id)
                throw new ConflictException("Bu online randevu adresi başka bir salon tarafından kullanılıyor.");
    }

    private async Task CheckReferencesAsync(List<RecordRow> rows, CancellationToken ct)
    {
        var inBatch = rows.Select(r => (new RecordKey(r.Collection, r.Id), r.TenantId)).ToDictionary(x => x.Item1, x => x.TenantId);
        var needed = new List<(RecordKey Key, string? TenantId, string Message)>();
        foreach (var r in rows)
        {
            var refs = References.GetValueOrDefault(r.Collection) ?? [];
            var data = JsonNode.Parse(r.Data)!;
            foreach (var (field, target, message) in refs)
                if (data[field] is JsonValue v && v.TryGetValue<string>(out var refId) && refId.Length > 0)
                    needed.Add((new RecordKey(target, refId), r.TenantId, message));
            // Paket tanımındaki her hizmet salonda var olmalı.
            if (r.Collection == "packageDefs")
                foreach (var item in (data["items"] as JsonArray ?? []).OfType<JsonObject>())
                    if (RecordRules.Str(item, "serviceId") is { Length: > 0 } sid) needed.Add((new RecordKey("services", sid), r.TenantId, "Hizmet bulunamadı."));
        }
        if (needed.Count == 0) return;
        var found = (await records.GetManyAsync([.. needed.Select(n => n.Key).Distinct()], ct)).ToDictionary(r => new RecordKey(r.Collection, r.Id), r => r.TenantId);
        foreach (var (key, tenantId, message) in needed)
        {
            var ok = inBatch.TryGetValue(key, out var t1) && t1 == tenantId || found.TryGetValue(key, out var t2) && t2 == tenantId;
            if (!ok) throw new ValidationException(message);
        }
    }
}
