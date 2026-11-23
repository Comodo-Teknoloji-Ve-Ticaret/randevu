namespace ComodoRandevuHazir.Domain;

public record License(DateOnly Start, int Days);

public enum LicenseState { Active, Expiring, Grace, Locked }

public record LicenseStatus(DateOnly End, int Used, int Remaining, LicenseState State, int GraceLeft);

/// <summary>Ön yüzdeki domain/license.ts ile birebir: bitiş = başlangıç + gün, 7 gün kala "yaklaşıyor", bitişten sonra 3 gün ek süre, sonra kilit.</summary>
public static class LicenseRules
{
    public const int GraceDays = 3;
    public const int ExpiringDays = 7;

    public static LicenseStatus Status(License l, DateOnly today)
    {
        var end = l.Start.AddDays(l.Days);
        var remaining = end.DayNumber - today.DayNumber;
        var used = Math.Max(0, Math.Min(l.Days, today.DayNumber - l.Start.DayNumber));
        var graceLeft = GraceDays + remaining;
        var state = remaining > ExpiringDays ? LicenseState.Active
            : remaining >= 0 ? LicenseState.Expiring
            : graceLeft >= 0 ? LicenseState.Grace
            : LicenseState.Locked;
        return new LicenseStatus(end, used, remaining, state, Math.Max(0, graceLeft));
    }
}
