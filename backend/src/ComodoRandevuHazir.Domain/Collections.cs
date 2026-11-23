namespace ComodoRandevuHazir.Domain;

/// <summary>Ön yüzdeki DB koleksiyonları (application/db.ts) ve kimlik önekleri (application/repos.ts).</summary>
public static class Collections
{
    public static readonly IReadOnlyDictionary<string, string> Prefix = new Dictionary<string, string>
    {
        ["tenants"] = "t_", ["branches"] = "b_", ["users"] = "u_", ["staff"] = "s_", ["categories"] = "c_",
        ["services"] = "sv_", ["customers"] = "m_", ["appointments"] = "a_", ["blocks"] = "bl_", ["tickets"] = "k_",
        ["debtCollections"] = "dc_", ["expenses"] = "e_", ["dayCloses"] = "dz_", ["products"] = "p_", ["stockMoves"] = "sm_",
        ["packageDefs"] = "pd_", ["customerPackages"] = "cp_", ["templates"] = "tp_", ["messages"] = "ml_", ["colorCards"] = "cc_",
    };

    public static IReadOnlyCollection<string> All => (IReadOnlyCollection<string>)Prefix.Keys;

    public static bool IsKnown(string name) => Prefix.ContainsKey(name);

    /// <summary>tenants koleksiyonunda kapsam kaydın kendi id'sidir; diğerlerinde tenantId alanı.</summary>
    public static bool ScopedBySelf(string name) => name == "tenants";
}
