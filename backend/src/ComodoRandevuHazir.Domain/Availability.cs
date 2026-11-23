using System.Text.RegularExpressions;

namespace ComodoRandevuHazir.Domain;

/// <summary>Gün içi dakika aralığı (540 = 09:00).</summary>
public record DayHours(int Open, int Close);

/// <summary>Haftanın günleri, 0 = Pazar (ön yüzdeki WeekHours); kapalı gün null.</summary>
public record WeekHours(DayHours?[] Days)
{
    public DayHours? For(DateOnly date) => Days.ElementAtOrDefault((int)date.DayOfWeek);
}

public record StaffAvailability(string Id, bool Active, WeekHours Hours);

/// <summary>Takvimde yer kaplayan randevu ya da blok (iptal/gelmedi randevu: Active = false).</summary>
public record Busy(string StaffId, DateOnly Date, int Start, int End, bool Active = true);

public record SlotQuery(DateOnly Date, int Duration, IReadOnlyList<StaffAvailability> Staff, IReadOnlyList<Busy> Busy,
    WeekHours? BranchHours = null, DateOnly? Today = null, int? NowMin = null, int MinLeadMin = 0, int Step = 15);

public record Slot(string StaffId, int Start);

/// <summary>Ön yüz domain/availability.ts ile birebir.</summary>
public static class Availability
{
    public static readonly string[] Statuses = ["pending", "confirmed", "arrived", "in_service", "completed", "no_show", "cancelled"];

    public static bool IsActiveStatus(string? status) => status is not ("cancelled" or "no_show");

    public static bool Overlaps(int aStart, int aEnd, int bStart, int bEnd) => aStart < bEnd && bStart < aEnd;

    public static (int Start, int End)? WorkingRange(StaffAvailability staff, DateOnly date, WeekHours? branchHours)
    {
        var s = staff.Hours.For(date);
        if (s is null) return null;
        var b = branchHours is null ? s : branchHours.For(date);
        if (b is null) return null;
        var start = Math.Max(s.Open, b.Open);
        var end = Math.Min(s.Close, b.Close);
        return end > start ? (start, end) : null;
    }

    public static List<Slot> FindSlots(SlotQuery q)
    {
        var output = new List<Slot>();
        if (q.Today is { } today && q.Date < today) return output;
        var earliest = q.Today == q.Date && q.NowMin is { } now ? now + q.MinLeadMin : 0;
        foreach (var s in q.Staff)
        {
            if (!s.Active || WorkingRange(s, q.Date, q.BranchHours) is not { } wr) continue;
            var busy = q.Busy.Where(b => b.StaffId == s.Id && b.Date == q.Date && b.Active).ToList();
            var first = (int)Math.Ceiling(Math.Max(wr.Start, earliest) / (double)q.Step) * q.Step;
            for (var t = first; t + q.Duration <= wr.End; t += q.Step)
                if (!busy.Any(b => Overlaps(b.Start, b.End, t, t + q.Duration))) output.Add(new Slot(s.Id, t));
        }
        return [.. output.OrderBy(x => x.Start)];
    }
}

/// <summary>Ön yüz domain/phone.ts: Türk numaraları 10 haneye (5321112233) indirgenir.</summary>
public static partial class Phone
{
    [GeneratedRegex("^[2-5][0-9]{9}$")]
    private static partial Regex Valid();

    public static string? Normalize(string? raw)
    {
        var d = new string((raw ?? "").Where(char.IsAsciiDigit).ToArray());
        if (d.StartsWith("90") && d.Length == 12) d = d[2..];
        if (d.StartsWith('0') && d.Length == 11) d = d[1..];
        return Valid().IsMatch(d) ? d : null;
    }

    public static bool IsNormalized(string? phone) => phone is not null && Valid().IsMatch(phone);
}
