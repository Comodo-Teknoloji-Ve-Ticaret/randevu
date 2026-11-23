namespace ComodoRandevuHazir.Domain;

/// <summary>Tutarlar kuruş (tam sayı). type: "percent" (0–100) ya da "amount" (kuruş).</summary>
public record Discount(string Type, int Value);

public record TicketLineAmount(int Qty, int UnitPrice, Discount? Discount);

public record PaymentAmount(string Method, int Amount);

public record TicketTotals(int Subtotal, int Discount, int Total, int Paid, int Debt, int Remaining);

/// <summary>Ön yüz domain/money.ts + domain/ticket.ts ile birebir (JS Math.round: yarımlar yukarı).</summary>
public static class Money
{
    public static readonly string[] PaymentMethods = ["cash", "card", "transfer", "debt"];
    public static readonly string[] LineKinds = ["service", "product", "package_sale", "package_use"];

    private static int Round(double v) => (int)Math.Floor(v + 0.5);

    public static int ApplyDiscount(int amount, Discount? d)
    {
        if (d is null || d.Value == 0) return amount;
        var off = d.Type == "percent" ? Round(amount * (double)Math.Min(100, d.Value) / 100) : d.Value;
        return Math.Max(0, amount - off);
    }

    public static int LineTotal(TicketLineAmount l) => ApplyDiscount(l.Qty * l.UnitPrice, l.Discount);

    public static TicketTotals Totals(IReadOnlyList<TicketLineAmount> lines, Discount? discount, int tip, IReadOnlyList<PaymentAmount> payments)
    {
        var subtotal = lines.Sum(LineTotal);
        var afterDiscount = ApplyDiscount(subtotal, discount);
        var total = afterDiscount + tip;
        var paid = payments.Where(p => p.Method != "debt").Sum(p => p.Amount);
        var debt = payments.Where(p => p.Method == "debt").Sum(p => p.Amount);
        return new TicketTotals(subtotal, subtotal - afterDiscount, total, paid, debt, total - paid - debt);
    }
}
