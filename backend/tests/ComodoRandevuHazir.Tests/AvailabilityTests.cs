using ComodoRandevuHazir.Domain;

namespace ComodoRandevuHazir.Tests;

/// <summary>Ön yüz domain/availability.test.ts ve phone.test.ts vakaları.</summary>
public class AvailabilityTests
{
    // 2026-11-20 Cuma; Pazar kapalı, diğer günler 09:00–12:00
    private static readonly WeekHours Hours9To12 = new(Enumerable.Range(0, 7).Select(d => d == 0 ? null : new DayHours(540, 720)).ToArray());
    private static readonly DateOnly Day = new(2026, 11, 20);
    private static StaffAvailability Staff(string id = "s1") => new(id, true, Hours9To12);
    private static Busy Appt(int start, int end, string staffId = "s1", bool active = true) => new(staffId, Day, start, end, active);

    private static SlotQuery Q(int duration, IReadOnlyList<Busy>? busy = null, WeekHours? branch = null, DateOnly? today = null, int? nowMin = null, int lead = 0, DateOnly? date = null) =>
        new(date ?? Day, duration, [Staff()], busy ?? [], branch, today, nowMin, lead);

    [Fact]
    public void Back_to_back_ranges_do_not_overlap()
    {
        Assert.False(Availability.Overlaps(600, 660, 660, 720));
        Assert.True(Availability.Overlaps(600, 661, 660, 720));
    }

    [Fact]
    public void Returns_only_free_15_minute_starts_inside_working_hours() =>
        Assert.Equal([540, 660], Availability.FindSlots(Q(60, [Appt(600, 660)])).Select(s => s.Start));

    [Fact]
    public void Respects_minimum_lead_time_today() =>
        Assert.Equal([660], Availability.FindSlots(Q(60, [Appt(600, 660)], today: Day, nowMin: 540, lead: 120)).Select(s => s.Start));

    [Fact]
    public void Ignores_cancelled_and_no_show() =>
        Assert.Contains(600, Availability.FindSlots(Q(60, [Appt(600, 660, active: false)])).Select(s => s.Start));

    [Fact]
    public void Nothing_on_closed_day_or_in_the_past()
    {
        Assert.Empty(Availability.FindSlots(Q(30, date: new DateOnly(2026, 11, 22))));
        Assert.Empty(Availability.FindSlots(Q(30, today: Day.AddDays(1))));
    }

    [Fact]
    public void Intersects_staff_hours_with_branch_hours()
    {
        var branch = new WeekHours(Hours9To12.Days.Select((h, i) => i == 5 ? new DayHours(600, 720) : h).ToArray());
        Assert.Equal(600, Availability.FindSlots(Q(60, branch: branch))[0].Start);
    }

    [Theory]
    [InlineData("0532 111 22 33")]
    [InlineData("+90 532 111 2233")]
    [InlineData("5321112233")]
    [InlineData("(0532) 111-22-33")]
    [InlineData("905321112233")]
    public void Normalizes_turkish_phone_spellings(string raw) => Assert.Equal("5321112233", Phone.Normalize(raw));

    [Theory]
    [InlineData("123")]
    [InlineData("")]
    [InlineData(null)]
    public void Rejects_short_phones(string? raw) => Assert.Null(Phone.Normalize(raw));
}
