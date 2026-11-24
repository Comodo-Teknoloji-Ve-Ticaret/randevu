namespace ComodoRandevuHazir.Domain;

/// <summary>Ön yüzdeki app/permissions.ts ile birebir rol → yetki tablosu ve koleksiyon yazma yetkileri.</summary>
public static class Permissions
{
    private static readonly Dictionary<string, string[]> Matrix = new()
    {
        ["owner"] = ["calendar", "calendar.all", "customers", "cash", "services", "staff", "stock", "packages", "messages", "reports", "settings", "commission.own"],
        ["reception"] = ["calendar", "calendar.all", "customers", "cash", "services", "stock", "packages", "messages"],
        ["staff"] = ["calendar", "customers", "commission.own"],
        ["platform"] = ["platform"],
    };

    /// <summary>Koleksiyona yazmak için bu yetkilerden biri yeter (ör. adisyon kapanışı stok hareketi de yazar).</summary>
    private static readonly Dictionary<string, string[]> WritePerms = new()
    {
        ["branches"] = ["settings"], ["users"] = ["settings"], ["staff"] = ["staff"],
        ["categories"] = ["services"], ["services"] = ["services"],
        ["customers"] = ["customers"], ["colorCards"] = ["customers"],
        ["appointments"] = ["calendar"], ["blocks"] = ["calendar"],
        ["tickets"] = ["cash"], ["debtCollections"] = ["cash"], ["expenses"] = ["cash"], ["dayCloses"] = ["cash"],
        ["products"] = ["stock", "cash"], ["stockMoves"] = ["stock", "cash"],
        ["packageDefs"] = ["packages"], ["customerPackages"] = ["packages", "cash"],
        ["templates"] = ["messages"], ["messages"] = ["messages", "calendar"],
        ["tenants"] = ["settings"],
    };

    /// <summary>Salon sahibinin kutucuklarla verebileceği yetkiler (ön yüz permissions.ts ALL_PERMS).</summary>
    public static readonly string[] SalonPerms = ["calendar", "calendar.all", "customers", "cash", "services", "staff", "stock", "packages", "messages", "reports", "settings", "commission.own"];

    public static bool Can(string role, string perm) => Matrix.TryGetValue(role, out var p) && p.Contains(perm);

    /// <summary>
    /// Kullanıcının geçerli yetkileri: salon sahibi ve Comodo yöneticisi her zaman rol tablosundan (kısıtlanamaz);
    /// diğerlerinde salon sahibinin verdiği özel liste varsa o, yoksa rolün varsayılanı.
    /// </summary>
    public static IReadOnlySet<string> Effective(string role, IEnumerable<string>? custom) =>
        role is "owner" or "platform" || custom is null
            ? (Matrix.TryGetValue(role, out var p) ? p : []).ToHashSet()
            : custom.Where(SalonPerms.Contains).ToHashSet();

    public static bool CanWrite(IReadOnlySet<string> perms, string collection) =>
        WritePerms.TryGetValue(collection, out var need) && need.Any(perms.Contains);

    public static bool CanWrite(string role, string collection) =>
        WritePerms.TryGetValue(collection, out var perms) && perms.Any(p => Can(role, p));

    /// <summary>Salon tarafının (platform dışı) asla değiştiremeyeceği işletme alanları.</summary>
    public static readonly string[] PlatformOnlyTenantFields = ["license", "status", "plan", "invite", "createdAt", "businessType"];

    /// <summary>Ayar yetkisi olmayan resepsiyonun işletme kaydında değiştirebileceği listeler (stok/kasa ekranlarından).</summary>
    public static readonly string[] ReceptionTenantFields = ["brands", "productCategories", "expenseCategories"];
}
