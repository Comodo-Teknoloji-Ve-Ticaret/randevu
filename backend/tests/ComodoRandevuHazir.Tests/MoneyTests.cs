using ComodoRandevuHazir.Domain;

namespace ComodoRandevuHazir.Tests;

/// <summary>Ön yüz domain/money.test.ts ve ticket.test.ts vakaları.</summary>
public class MoneyTests
{
    private static TicketLineAmount Line(int unitPrice, int qty = 1, Discount? discount = null) => new(qty, unitPrice, discount);

    [Fact]
    public void Percent_discount_rounds_to_kurus()
    {
        Assert.Equal(8500, Money.ApplyDiscount(10000, new Discount("percent", 15)));
        Assert.Equal(669, Money.ApplyDiscount(999, new Discount("percent", 33)));
    }

    [Fact]
    public void Amount_discount_never_below_zero()
    {
        Assert.Equal(7500, Money.ApplyDiscount(10000, new Discount("amount", 2500)));
        Assert.Equal(0, Money.ApplyDiscount(1000, new Discount("amount", 2500)));
        Assert.Equal(1000, Money.ApplyDiscount(1000, null));
    }

    [Fact]
    public void Ticket_discount_with_split_payment_and_debt()
    {
        var t = Money.Totals([Line(45000), Line(30000)], new Discount("percent", 10), 0, [new PaymentAmount("cash", 40000), new PaymentAmount("card", 20000), new PaymentAmount("debt", 7500)]);
        Assert.Equal(new TicketTotals(75000, 7500, 67500, 60000, 7500, 0), t);
    }

    [Fact]
    public void Tip_is_added_and_line_discounts_apply_first()
    {
        var l = Line(10000, 2, new Discount("percent", 15));
        Assert.Equal(17000, Money.LineTotal(l));
        var t = Money.Totals([l], null, 2000, []);
        Assert.Equal((17000, 19000, 19000), (t.Subtotal, t.Total, t.Remaining));
    }
}
