using ComodoRandevuHazir.Application;
using ComodoRandevuHazir.Infrastructure;
using ComodoRandevuHazir.Infrastructure.Persistence;
using ComodoRandevuHazir.Infrastructure.Security;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Diagnostics;
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
});

var app = builder.Build();

if (app.Configuration.GetValue("Database:Migrate", true))
{
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.Migrate();
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
});

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

// Girişsiz online randevu (müşterinin telefonundan)
var pub = api.MapGroup("/public/{slug}");
pub.MapGet("", (string slug, PublicBookingService s, CancellationToken ct) => s.InfoAsync(slug, ct));
pub.MapGet("/slots", (string slug, string branchId, string serviceIds, string? staffId, string date, PublicBookingService s, CancellationToken ct) =>
    s.SlotsAsync(slug, branchId, serviceIds.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries), staffId ?? "any", date, ct));
pub.MapPost("/book", (string slug, BookingRequest req, PublicBookingService s, CancellationToken ct) => s.BookAsync(slug, req, ct))
   .RequireRateLimiting("booking");

app.Run();

public partial class Program;
