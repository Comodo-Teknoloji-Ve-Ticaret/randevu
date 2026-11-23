using System.Security.Cryptography;
using System.Text.Json.Nodes;
using ComodoRandevuHazir.Domain;
using static ComodoRandevuHazir.Application.RecordRules;

namespace ComodoRandevuHazir.Application;

public record BookingRequest(string BranchId, List<string> ServiceIds, string StaffId, string Date, int Start, string Name, string Phone, string? Note);
public record BookingResult(string Code, string Status);

/// <summary>
/// Girişsiz online randevu (ön yüz application/bookingService.ts ile aynı kurallar).
/// Yalnız randevu için gereken alanlar dışarı verilir: müşteri listesi, telefonlar, primler, lisans asla.
/// </summary>
public class PublicBookingService(IRecordStore records, IClock clock)
{
    private const string NotAvailable = "Salon bulunamadı ya da online randevu kapalı.";

    private sealed record Salon(string TenantId, JsonObject Tenant, int MaxDaysAhead, int MinLeadMinutes, bool RequireApproval);

    private async Task<Salon> LiveAsync(string slug, CancellationToken ct)
    {
        var row = await records.FindTenantBySlugAsync(slug, ct) ?? throw new NotFoundException(NotAvailable);
        var t = JsonNode.Parse(row.Data)!.AsObject();
        if (Str(t, "status") == "suspended") throw new NotFoundException(NotAvailable);
        if (t["license"] is JsonObject l && Str(l, "start") is { } start && Int(l, "days") is { } days
            && LicenseRules.Status(new License(DateOnly.Parse(start), days), clock.Today).State == LicenseState.Locked)
            throw new NotFoundException(NotAvailable);
        if (t["onlineBooking"] is not JsonObject ob || ob["enabled"]?.GetValue<bool>() != true) throw new NotFoundException(NotAvailable);
        return new Salon(row.Id, t, Int(ob, "maxDaysAhead") ?? 30, Int(ob, "minLeadMinutes") ?? 60, ob["requireApproval"]?.GetValue<bool>() ?? true);
    }

    private async Task<List<JsonObject>> ListAsync(string tenantId, string collection, CancellationToken ct) =>
        [.. (await records.ListCollectionAsync(tenantId, collection, ct)).Select(r => JsonNode.Parse(r.Data)!.AsObject())];

    private static JsonObject Pick(JsonObject o, params string[] fields)
    {
        var r = new JsonObject();
        foreach (var f in fields) if (o.TryGetPropertyValue(f, out var v)) r[f] = v?.DeepClone();
        return r;
    }

    private static bool Active(JsonObject staff) => staff["active"] is not JsonValue v || !v.TryGetValue<bool>(out var b) || b;

    private static List<string> Strings(JsonNode? arr) => arr is JsonArray a ? [.. a.Select(x => x?.GetValue<string>()).OfType<string>()] : [];

    public async Task<JsonObject> InfoAsync(string slug, CancellationToken ct)
    {
        var salon = await LiveAsync(slug, ct);
        var staff = (await ListAsync(salon.TenantId, "staff", ct)).Where(Active).ToList();
        var offered = staff.SelectMany(s => Strings(s["serviceIds"])).ToHashSet();
        return new JsonObject
        {
            ["tenant"] = Pick(salon.Tenant, "id", "name", "slug", "logoColor", "businessType", "onlineBooking"),
            ["branches"] = new JsonArray([.. (await ListAsync(salon.TenantId, "branches", ct)).Select(b => Pick(b, "id", "tenantId", "name", "address", "phone", "hours"))]),
            ["categories"] = new JsonArray([.. (await ListAsync(salon.TenantId, "categories", ct)).OrderBy(c => Int(c, "order") ?? 0).Select(c => Pick(c, "id", "tenantId", "name", "color", "order"))]),
            ["services"] = new JsonArray([.. (await ListAsync(salon.TenantId, "services", ct))
                .Where(s => s["online"]?.GetValue<bool>() == true && offered.Contains(Str(s, "id")!))
                .Select(s => Pick(s, "id", "tenantId", "categoryId", "name", "duration", "price", "online", "overrides"))]),
            ["staff"] = new JsonArray([.. staff.Select(s => Pick(s, "id", "tenantId", "branchId", "name", "title", "color", "hours", "serviceIds", "active"))]),
        };
    }

    public async Task<List<Slot>> SlotsAsync(string slug, string branchId, IReadOnlyList<string> serviceIds, string staffId, string date, CancellationToken ct) =>
        await SlotsForAsync(await LiveAsync(slug, ct), branchId, serviceIds, staffId, date, ct);

    private async Task<List<Slot>> SlotsForAsync(Salon salon, string branchId, IReadOnlyList<string> serviceIds, string staffId, string dateText, CancellationToken ct)
    {
        if (serviceIds.Count == 0 || !DateOnly.TryParse(dateText, out var date)) return [];
        var today = clock.Today;
        var ahead = date.DayNumber - today.DayNumber;
        if (ahead < 0 || ahead > salon.MaxDaysAhead) return [];

        var branch = (await records.GetAsync("branches", branchId, ct)) is { } br && br.TenantId == salon.TenantId ? JsonNode.Parse(br.Data)!.AsObject() : null;
        if (branch is null) return [];
        var services = (await ListAsync(salon.TenantId, "services", ct)).ToDictionary(s => Str(s, "id")!);
        if (!serviceIds.All(services.ContainsKey)) return [];
        var candidates = (await ListAsync(salon.TenantId, "staff", ct))
            .Where(s => Str(s, "branchId") == branchId && Active(s) && (staffId == "any" || Str(s, "id") == staffId))
            .Where(s => serviceIds.All(Strings(s["serviceIds"]).Contains))
            .ToList();

        var appts = await ListByDateAsync(salon.TenantId, "appointments", dateText, ct);
        var busy = appts.Select(a => new Busy(Str(a, "staffId")!, date, Int(a, "start") ?? 0, Int(a, "end") ?? 0, Availability.IsActiveStatus(Str(a, "status"))))
            .Concat((await ListByDateAsync(salon.TenantId, "blocks", dateText, ct)).Select(b => new Busy(Str(b, "staffId")!, date, Int(b, "start") ?? 0, Int(b, "end") ?? 0)))
            .ToList();

        var all = candidates.SelectMany(s => Availability.FindSlots(new SlotQuery(date,
            serviceIds.Sum(id => DurationFor(services[id], Str(s, "id")!)),
            [new StaffAvailability(Str(s, "id")!, true, Hours(s["hours"]))], busy, Hours(branch["hours"]), today, clock.NowMinutes, salon.MinLeadMinutes)));

        // "Fark etmez": her saatte o gün en az randevusu olan personel öne alınır.
        var load = candidates.ToDictionary(s => Str(s, "id")!, s => appts.Count(a => Str(a, "staffId") == Str(s, "id")));
        return [.. all.OrderBy(x => load.GetValueOrDefault(x.StaffId)).GroupBy(x => x.Start).Select(g => g.First()).OrderBy(x => x.Start)];
    }

    public async Task<BookingResult> BookAsync(string slug, BookingRequest req, CancellationToken ct)
    {
        var salon = await LiveAsync(slug, ct);
        var phone = Phone.Normalize(req.Phone) ?? throw new ValidationException("Telefon numarası geçersiz.");
        if (string.IsNullOrWhiteSpace(req.Name) || req.ServiceIds is not { Count: > 0 }) throw new ValidationException("Ad soyad ve hizmet seçimi gerekli.");
        if (!DateOnly.TryParseExact(req.Date, "yyyy-MM-dd", out _)) throw new ValidationException("Geçersiz tarih.");

        // Aynı salonun aynı günü için kayıtlar sırayla işlenir: iki müşteri aynı saati alamaz.
        return await records.InLockAsync($"book:{salon.TenantId}:{req.Date}", async () =>
        {
            var slot = (await SlotsForAsync(salon, req.BranchId, req.ServiceIds, req.StaffId, req.Date, ct)).FirstOrDefault(s => s.Start == req.Start)
                ?? throw new ConflictException("Bu saat az önce doldu. Lütfen başka bir saat seçin.");

            var rows = new List<RecordRow>();
            var customerId = (await records.ListByFieldAsync(salon.TenantId, "customers", "phone", phone, ct)).FirstOrDefault()?.Id;
            if (customerId is null)
            {
                customerId = NewId("m_");
                rows.Add(Row("customers", customerId, salon.TenantId, new JsonObject
                {
                    ["id"] = customerId, ["tenantId"] = salon.TenantId, ["name"] = req.Name.Trim(), ["phone"] = phone,
                    ["tags"] = new JsonArray("Yeni"), ["notes"] = "", ["consentSms"] = true, ["createdAt"] = clock.Today.ToString("yyyy-MM-dd"),
                }));
            }

            var services = (await ListAsync(salon.TenantId, "services", ct)).ToDictionary(s => Str(s, "id")!);
            var items = req.ServiceIds.Select(id => new JsonObject
            {
                ["serviceId"] = id, ["price"] = PriceFor(services[id], slot.StaffId), ["duration"] = DurationFor(services[id], slot.StaffId),
            }).ToList();
            var status = salon.RequireApproval ? "pending" : "confirmed";
            var code = NewCode();
            var id = NewId("a_");
            rows.Add(Row("appointments", id, salon.TenantId, new JsonObject
            {
                ["id"] = id, ["tenantId"] = salon.TenantId, ["branchId"] = req.BranchId, ["staffId"] = slot.StaffId, ["customerId"] = customerId,
                ["date"] = req.Date, ["start"] = slot.Start, ["end"] = slot.Start + items.Sum(i => i["duration"]!.GetValue<int>()),
                ["items"] = new JsonArray([.. items]), ["status"] = status, ["source"] = "online", ["note"] = (req.Note ?? "").Trim(),
                ["code"] = code, ["createdAt"] = DateTime.UtcNow.ToString("o"),
            }));
            await records.ApplyAsync(rows, [], ct);
            return new BookingResult(code, status);
        }, ct);
    }

    private async Task<List<JsonObject>> ListByDateAsync(string tenantId, string collection, string date, CancellationToken ct) =>
        [.. (await records.ListByFieldAsync(tenantId, collection, "date", date, ct)).Select(r => JsonNode.Parse(r.Data)!.AsObject())];

    private static RecordRow Row(string collection, string id, string tenantId, JsonObject data) => new(collection, id, tenantId, data.ToJsonString());

    private static int Override(JsonObject service, string staffId, string field) =>
        service["overrides"]?[staffId]?[field] is JsonValue v && v.TryGetValue<int>(out var n) && n != 0 ? n : Int(service, field) ?? 0;

    private static int DurationFor(JsonObject service, string staffId) => Override(service, staffId, "duration");
    private static int PriceFor(JsonObject service, string staffId) => Override(service, staffId, "price");

    private static WeekHours? Hours(JsonNode? node) => node is not JsonObject o ? null
        : new WeekHours([.. Enumerable.Range(0, 7).Select(d => o[d.ToString()] is JsonObject h && Int(h, "open") is { } open && Int(h, "close") is { } close ? new DayHours(open, close) : null)]);

    private const string Base36 = "0123456789abcdefghijklmnopqrstuvwxyz";
    private static string Random36(int n) => new([.. Enumerable.Range(0, n).Select(_ => Base36[RandomNumberGenerator.GetInt32(36)])]);
    public static string NewId(string prefix) => prefix + Random36(8);
    public static string NewCode() => "RH-" + Random36(6).ToUpperInvariant();
}
