# RandevunHazır API — çok aşamalı imaj
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY ComodoRandevuHazir.slnx ./
COPY src/ComodoRandevuHazir.Domain/*.csproj src/ComodoRandevuHazir.Domain/
COPY src/ComodoRandevuHazir.Application/*.csproj src/ComodoRandevuHazir.Application/
COPY src/ComodoRandevuHazir.Infrastructure/*.csproj src/ComodoRandevuHazir.Infrastructure/
COPY src/ComodoRandevuHazir.WebApi/*.csproj src/ComodoRandevuHazir.WebApi/
RUN dotnet restore src/ComodoRandevuHazir.WebApi/ComodoRandevuHazir.WebApi.csproj
COPY src/ src/
RUN dotnet publish src/ComodoRandevuHazir.WebApi/ComodoRandevuHazir.WebApi.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
USER app
ENTRYPOINT ["dotnet", "ComodoRandevuHazir.WebApi.dll"]
