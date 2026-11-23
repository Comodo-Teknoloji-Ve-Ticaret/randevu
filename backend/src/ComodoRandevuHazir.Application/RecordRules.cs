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
            case "customers":
                if (Str(data, "phone") is { Length: > 0 } phone && !Phone.IsNormalized(phone)) throw new ValidationException("Telefon numarası geçersiz.");
                break;
        }
    }

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
