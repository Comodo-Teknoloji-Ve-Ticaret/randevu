using Microsoft.Extensions.DependencyInjection;

namespace ComodoRandevuHazir.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services) => services
        .AddScoped<ImportService>()
        .AddScoped<AuthService>()
        .AddScoped<SyncService>()
        .AddScoped<BatchService>();
}
