var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins(builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? ["http://127.0.0.1:5317", "http://localhost:5317"])
     .AllowAnyHeader()
     .AllowAnyMethod()));

var app = builder.Build();
app.UseCors();

var api = app.MapGroup("/api");
api.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();

public partial class Program;
