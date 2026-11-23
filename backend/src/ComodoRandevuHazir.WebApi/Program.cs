using ComodoRandevuHazir.Application;
using ComodoRandevuHazir.Infrastructure;
using ComodoRandevuHazir.Infrastructure.Persistence;
using ComodoRandevuHazir.Infrastructure.Security;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddApplication().AddInfrastructure();
builder.Services.AddProblemDetails();
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins(builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? ["http://127.0.0.1:5317", "http://localhost:5317"])
     .AllowAnyHeader()
     .AllowAnyMethod()));

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
builder.Services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme).Configure<JwtOptions>((o, jwt) =>
{
    o.MapInboundClaims = false;
    o.TokenValidationParameters = new TokenValidationParameters
    {
        ValidIssuer = JwtOptions.Issuer,
        ValidAudience = JwtOptions.Issuer,
        IssuerSigningKey = jwt.SigningKey(),
        ClockSkew = TimeSpan.FromMinutes(1),
    };
});
builder.Services.AddAuthorization();

// Online randevu herkese açık: aynı istemciden dakikada en fazla N kayıt (varsayılan 20).
builder.Services.AddRateLimiter(_ => { });
builder.Services.AddOptions<RateLimiterOptions>().Configure<IConfiguration>((o, config) =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("booking", http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = config.GetValue("RateLimit:BookPerMinute", 20), Window = TimeSpan.FromMinutes(1) }));
    // Giriş / şifre sıfırlama: kaba kuvvet denemelerine karşı istemci başına dakikada N istek (varsayılan 10).
    o.AddPolicy("auth", http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = config.GetValue("RateLimit:AuthPerMinute", 10), Window = TimeSpan.FromMinutes(1) }));
});

var app = builder.Build();

if (app.Configuration.GetValue("Database:Migrate", true))
{
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.Migrate();
    // İlk Comodo yönetici hesabı (yalnız ayarlanmışsa; mevcut hesaba dokunmaz)
    if (app.Configuration["Admin:Email"] is { Length: > 0 } adminEmail)
        await scope.ServiceProvider.GetRequiredService<AccountService>()
            .EnsurePlatformAdminAsync(adminEmail, app.Configuration["Admin:Password"] ?? "", CancellationToken.None);
}

// HTTPS için önde ters vekil (Caddy/Nginx) varsa gerçek istemci adresi X-Forwarded-For'dan alınır.
// Yalnız API doğrudan internete açık DEĞİLKEN açın (aksi hâlde başlık taklit edilebilir).
if (app.Configuration.GetValue("Proxy:Trusted", false))
{
    var fwd = new ForwardedHeadersOptions { ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto };
    fwd.KnownIPNetworks.Clear();
    fwd.KnownProxies.Clear();
    app.UseForwardedHeaders(fwd);
}

// Uygulama hatalarını RFC 7807 ProblemDetails'e çevir (başlık Türkçe, kullanıcıya gösterilebilir).
app.UseExceptionHandler(errorApp => errorApp.Run(async ctx =>
{
    var ex = ctx.Features.Get<IExceptionHandlerFeature>()?.Error;
    var (status, title) = ex switch
    {
        ValidationException v => (StatusCodes.Status400BadRequest, v.Message),
        UnauthorizedException u => (StatusCodes.Status401Unauthorized, u.Message),
        ForbiddenException f => (StatusCodes.Status403Forbidden, f.Message),
        NotFoundException n => (StatusCodes.Status404NotFound, n.Message),
        ConflictException c => (StatusCodes.Status409Conflict, c.Message),
        _ => (StatusCodes.Status500InternalServerError, "Beklenmeyen bir hata oluştu."),
    };
    ctx.Response.StatusCode = status;
    await Results.Problem(title: title, statusCode: status).ExecuteAsync(ctx);
}));
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

var api = app.MapGroup("/api");

api.MapGet("/health", () => Results.Ok(new { status = "ok" }));

api.MapPost("/auth/login", async (LoginRequest req, AuthService auth, CancellationToken ct) =>
{
    var r = await auth.LoginAsync(req, ct);
    return Results.Ok(new { token = r.Token, user = r.User });
}).RequireRateLimiting("auth");

// Şifre: kendi şifresini değiştirme; unutulan şifre için e-postayla kod
api.MapPost("/me/password", async (ChangePasswordRequest req, HttpContext http, PasswordService s, CancellationToken ct) =>
{
    await s.ChangeAsync(JwtTokenIssuer.Read(http.User) ?? throw new UnauthorizedException("Oturum geçersiz."), req, ct);
    return Results.Ok(new { ok = true });
}).RequireAuthorization();
api.MapPost("/auth/forgot", async (ForgotPasswordRequest req, PasswordService s, CancellationToken ct) =>
{
    await s.ForgotAsync(req, ct);
    return Results.Ok(new { ok = true });
}).RequireRateLimiting("auth");
api.MapPost("/auth/reset", async (ResetPasswordRequest req, PasswordService s, CancellationToken ct) =>
{
    await s.ResetAsync(req, ct);
    return Results.Ok(new { ok = true });
}).RequireRateLimiting("auth");

api.MapGet("/sync", async (HttpContext http, SyncService sync, CancellationToken ct) =>
{
    var who = JwtTokenIssuer.Read(http.User) ?? throw new UnauthorizedException("Oturum geçersiz.");
    return Results.Content(await sync.SnapshotAsync(who, ct), "application/json; charset=utf-8");
}).RequireAuthorization();

api.MapPost("/batch", async (BatchRequest req, HttpContext http, BatchService batch, CancellationToken ct) =>
{
    var who = JwtTokenIssuer.Read(http.User) ?? throw new UnauthorizedException("Oturum geçersiz.");
    return Results.Ok(new { applied = await batch.ApplyAsync(who, req, ct) });
}).RequireAuthorization();

// Davet linkiyle salon sahibinin hesabını açması (girişsiz)
api.MapGet("/invite/{token}", (string token, AccountService s, CancellationToken ct) => s.InviteInfoAsync(token, ct));
api.MapPost("/invite/{token}", async (string token, InviteAccept req, AccountService s, CancellationToken ct) =>
{
    var r = await s.AcceptInviteAsync(token, req, ct);
    return Results.Ok(new { token = r.Token, user = r.User });
}).RequireRateLimiting("booking");

// Sahibin personeline giriş e-postası/şifresi tanımlaması
api.MapPost("/users/{id}/credentials", async (string id, CredentialsRequest req, HttpContext http, AccountService s, CancellationToken ct) =>
{
    await s.SetCredentialsAsync(JwtTokenIssuer.Read(http.User) ?? throw new UnauthorizedException("Oturum geçersiz."), id, req, ct);
    return Results.Ok(new { ok = true });
}).RequireAuthorization();
api.MapPost("/users/{id}/email", async (string id, EmailRequest req, HttpContext http, AccountService s, CancellationToken ct) =>
{
    await s.ChangeEmailAsync(JwtTokenIssuer.Read(http.User) ?? throw new UnauthorizedException("Oturum geçersiz."), id, req, ct);
    return Results.Ok(new { ok = true });
}).RequireAuthorization();
api.MapPost("/users/{id}/password", async (string id, PasswordRequest req, HttpContext http, AccountService s, CancellationToken ct) =>
{
    await s.ChangePasswordAsync(JwtTokenIssuer.Read(http.User) ?? throw new UnauthorizedException("Oturum geçersiz."), id, req, ct);
    return Results.Ok(new { ok = true });
}).RequireAuthorization();
api.MapGet("/users/emails", (HttpContext http, AccountService s, CancellationToken ct) =>
    s.EmailsAsync(JwtTokenIssuer.Read(http.User) ?? throw new UnauthorizedException("Oturum geçersiz."), ct)).RequireAuthorization();

// Yalnız geliştirme/demo ortamında (Demo:AllowReset=true): tüm veriyi demo verisiyle değiştirir.
api.MapPost("/dev/reset", async (System.Text.Json.Nodes.JsonObject db, IConfiguration config, AccountService s, CancellationToken ct) =>
{
    if (!config.GetValue("Demo:AllowReset", false)) return Results.NotFound();
    return Results.Ok(new { imported = await s.ResetDemoAsync(db, ct) });
});

// Yalnız demo/geliştirme: simülasyonda "gönderilen" son e-posta (şifre sıfırlama kodunu yerelde görmek için)
api.MapGet("/dev/emails", (string to, IConfiguration config, ComodoRandevuHazir.Infrastructure.Messaging.SimulatedEmailSender mail) =>
{
    if (!config.GetValue("Demo:AllowReset", false)) return Results.NotFound();
    var m = mail.Sent.LastOrDefault(x => x.To.Equals(to.Trim(), StringComparison.OrdinalIgnoreCase));
    return m is null ? Results.NotFound() : Results.Ok(new { to = m.To, subject = m.Subject, body = m.Body });
});

// Girişsiz online randevu (müşterinin telefonundan)
var pub = api.MapGroup("/public/{slug}");
pub.MapGet("", (string slug, PublicBookingService s, CancellationToken ct) => s.InfoAsync(slug, ct));
pub.MapGet("/slots", async (string slug, string branchId, string serviceIds, string? staffId, string date, int? days, PublicBookingService s, CancellationToken ct) =>
{
    var ids = serviceIds.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    return days is null
        ? Results.Ok(await s.SlotsAsync(slug, branchId, ids, staffId ?? "any", date, ct))
        : Results.Ok(await s.SlotRangeAsync(slug, branchId, ids, staffId ?? "any", date, days.Value, ct));
});
pub.MapPost("/book", (string slug, BookingRequest req, PublicBookingService s, CancellationToken ct) => s.BookAsync(slug, req, ct))
   .RequireRateLimiting("booking");

app.Run();

public partial class Program;
