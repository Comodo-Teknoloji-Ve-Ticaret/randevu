using System.Globalization;
using System.Text.Json.Nodes;
using ComodoRandevuHazir.Domain;

namespace ComodoRandevuHazir.Application;

/// <summary>Kayıt içeriği kuralları. Ön yüz bu kurallara zaten uyar; sunucu bozuk/kötü niyetli veriyi reddeder.</summary>
public static class RecordRules
{
    public static void Validate(string collection, JsonObject data)
    {
        switch (collection)
        {
            case "appointments":
                RequireDate(data);
                RequireRange(data, "Randevu saatleri geçersiz.");
                if (Str(data, "status") is not { } st || !Availability.Statuses.Contains(st)) throw new ValidationException("Geçersiz randevu durumu.");
                break;
            case "blocks":
                RequireDate(data);
                RequireRange(data, "Blok saatleri geçersiz.");
                break;
            case "products":
                if (Str(data, "name") is not { Length: > 0 } || Str(data, "kind") is not ("retail" or "professional")
                    || Int(data, "price") is not >= 0 || Int(data, "cost") is not >= 0 || Int(data, "vatRate") is not (>= 0 and <= 100)
                    || Int(data, "critical") is not >= 0 || Int(data, "stock") is null)
                    throw new ValidationException("Ürün bilgileri geçersiz.");
                break;
            case "stockMoves":
                RequireDate(data);
                var ok = (Str(data, "kind"), Int(data, "qty")) switch
                {
                    ("in", > 0) or ("sale", < 0) or ("use", < 0) => true,
                    ("adjust", { } q) => q != 0,
                    _ => false,
                };
                if (!ok || Str(data, "productId") is not { Length: > 0 }) throw new ValidationException("Stok hareketi geçersiz.");
                break;
            case "packageDefs":
                var items = data["items"] as JsonArray;
                if (Str(data, "name") is not { Length: > 0 } || Int(data, "price") is not >= 0 || Int(data, "validDays") is not > 0 || items is not { Count: > 0 }
                    || items.Any(i => i is not JsonObject o || Str(o, "serviceId") is null || Int(o, "count") is not > 0 || o["bonus"] is not null && Int(o, "bonus") is not >= 0))
                    throw new ValidationException("Paket bilgileri geçersiz.");
                break;
            case "messages":
                if (Str(data, "kind") is not { } mk || !MessageKinds.Contains(mk) || Str(data, "channel") is not "whatsapp"
                    || Str(data, "body") is not { Length: > 0 and <= MaxMessageLength })
                    throw new ValidationException("Mesaj geçersiz.");
                break;
            case "templates":
                if (Str(data, "kind") is not { } tk || !MessageKinds.Contains(tk) || Str(data, "body") is not { Length: > 0 and <= MaxMessageLength })
                    throw new ValidationException("Şablon geçersiz.");
                break;
            case "users":
                if (data["perms"] is JsonArray list)
                {
                    foreach (var x in list)
                        if (x is not JsonValue v || !v.TryGetValue<string>(out var perm) || !Permissions.SalonPerms.Contains(perm))
                            throw new ValidationException($"Geçersiz yetki: {x?.ToJsonString()}");
                    if (Str(data, "role") is "owner" or "platform") data.Remove("perms"); // sahip kısıtlanamaz
                }
                break;
            case "customers":
                if (Str(data, "phone") is { Length: > 0 } phone && !Phone.IsNormalized(phone)) throw new ValidationException("Telefon numarası geçersiz.");
                break;
        }
    }

    public static readonly string[] MessageKinds = ["confirm", "reminder", "cancel", "birthday", "winback"];

    /// <summary>Mesaj/şablon metni üst sınırı (karakter).</summary>
    public const int MaxMessageLength = 918;

    public static string? Str(JsonObject o, string field) => o[field] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    public static int? Int(JsonObject o, string field) => o[field] is JsonValue v && v.TryGetValue<int>(out var n) ? n : null;

    public static DateOnly RequireDate(JsonObject o, string field = "date") =>
        DateOnly.TryParseExact(Str(o, field), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)
            ? d : throw new ValidationException("Geçersiz tarih.");

    private static void RequireRange(JsonObject o, string message)
    {
        if (Int(o, "start") is not { } start || Int(o, "end") is not { } end || start < 0 || end > 24 * 60 || end <= start)
            throw new ValidationException(message);
    }
}
