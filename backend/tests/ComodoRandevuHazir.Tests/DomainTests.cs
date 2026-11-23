using ComodoRandevuHazir.Domain;

namespace ComodoRandevuHazir.Tests;

public class LicenseRulesTests
{
    private static LicenseStatus S(string start, int days, string today) =>
        LicenseRules.Status(new License(DateOnly.Parse(start), days), DateOnly.Parse(today));

    [Fact]
    public void Counts_used_and_remaining_days()
    {
        var s = S("2026-11-15", 30, "2026-11-20");
        Assert.Equal((DateOnly.Parse("2026-12-15"), 5, 25, LicenseState.Active), (s.End, s.Used, s.Remaining, s.State));
    }

    [Fact]
    public void Is_expiring_within_last_7_days() =>
        Assert.Equal((7, LicenseState.Expiring), (S("2026-10-28", 30, "2026-11-20") is var s ? (s.Remaining, s.State) : default));

    [Fact]
    public void Gives_grace_then_locks()
    {
        Assert.Equal(3, LicenseRules.GraceDays);
        var a = S("2026-10-20", 30, "2026-11-20");
        Assert.Equal((-1, LicenseState.Grace, 2), (a.Remaining, a.State, a.GraceLeft));
        var b = S("2026-10-20", 30, "2026-11-22");
        Assert.Equal((LicenseState.Grace, 0), (b.State, b.GraceLeft));
        Assert.Equal(LicenseState.Locked, S("2026-10-20", 30, "2026-11-23").State);
    }

    [Fact]
    public void Expires_at_end_of_last_day() =>
        Assert.Equal((0, LicenseState.Expiring), (S("2026-10-21", 30, "2026-11-20") is var s ? (s.Remaining, s.State) : default));
}

public class CollectionsTests
{
    [Fact]
    public void Knows_all_twenty_frontend_collections()
    {
        Assert.Equal(20, Collections.All.Count);
        Assert.True(Collections.IsKnown("appointments"));
        Assert.False(Collections.IsKnown("credentials"));
    }

    [Fact]
    public void Tenants_are_scoped_by_their_own_id() =>
        Assert.True(Collections.ScopedBySelf("tenants") && !Collections.ScopedBySelf("customers"));
}
