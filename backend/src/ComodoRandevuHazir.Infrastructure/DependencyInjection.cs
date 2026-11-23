using ComodoRandevuHazir.Application;
using ComodoRandevuHazir.Infrastructure.Messaging;
using ComodoRandevuHazir.Infrastructure.Persistence;
using ComodoRandevuHazir.Infrastructure.Security;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace ComodoRandevuHazir.Infrastructure;

public static class DependencyInjection
{
    /// <summary>Ayarlar ilk kullanımda okunur (test ve ortam değişkenleri derlemeden sonra da eklenebilir).</summary>
    public static IServiceCollection AddInfrastructure(this IServiceCollection services) => services
        .AddDbContext<AppDbContext>((sp, o) => o.UseNpgsql(sp.GetRequiredService<IConfiguration>().GetConnectionString("Db")
            ?? throw new InvalidOperationException("ConnectionStrings:Db tanımlı değil (ortam değişkeni ConnectionStrings__Db).")))
        .AddSingleton(TimeProvider.System)
        .AddSingleton(sp => sp.GetRequiredService<IConfiguration>().GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions())
        .AddSingleton<IClock, IstanbulClock>()
        .AddSingleton<IPasswordHasher, PasswordHasher>()
        .AddSingleton<ITokenIssuer, JwtTokenIssuer>()
        .AddScoped<IRecordStore, RecordStore>()
        .AddScoped<ICredentialStore, CredentialStore>()
        // SMS: Sms:Provider = simulation (varsayılan) | netgsm | iletimerkezi
        .AddSingleton<SimulatedSmsSender>()
        .AddSingleton<ISmsSender>(sp =>
        {
            var o = sp.GetRequiredService<IConfiguration>().GetSection("Sms").Get<SmsOptions>() ?? new SmsOptions();
            var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
            return o.Provider.ToLowerInvariant() switch
            {
                "netgsm" => new NetgsmSmsSender(http, o),
                "iletimerkezi" => new IletiMerkeziSmsSender(http, o),
                _ => sp.GetRequiredService<SimulatedSmsSender>(),
            };
        })
        .AddScoped<IPasswordResetStore, PasswordResetStore>()
        .AddSingleton<SimulatedEmailSender>()
        .AddSingleton<IEmailSender>(sp => sp.GetRequiredService<IConfiguration>().GetSection("Smtp").Get<SmtpOptions>() is { Host.Length: > 0 } smtp
            ? new SmtpEmailSender(smtp)
            : sp.GetRequiredService<SimulatedEmailSender>());
}
