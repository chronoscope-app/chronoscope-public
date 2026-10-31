$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Get-Counter -Counter '\GPU Engine(*)\Utilization Percentage','\GPU Process Memory(*)\Dedicated Usage','\GPU Process Memory(*)\Shared Usage' -SampleInterval 1 -Continuous -ErrorAction SilentlyContinue | ForEach-Object {
  $sample = $_
  $items = @($sample.CounterSamples | Where-Object { ($_.Status -eq 0 -or $_.Status -eq 1) -and $_.CookedValue -ge 0 } | ForEach-Object {
    [pscustomobject]@{ n=$_.InstanceName; p=$_.Path; v=$_.CookedValue }
  })
  [pscustomobject]@{ unix_ms=([DateTimeOffset]$sample.Timestamp).ToUnixTimeMilliseconds(); counters=$items } | ConvertTo-Json -Depth 4 -Compress
}
