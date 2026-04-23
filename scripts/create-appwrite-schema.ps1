param(
  [Parameter(Mandatory = $true)]
  [string]$Endpoint,

  [Parameter(Mandatory = $true)]
  [string]$ProjectId,

  [Parameter(Mandatory = $true)]
  [string]$ApiKey,

  [string]$DatabaseId = "torvi",
  [string]$DatabaseName = "Torvi",
  [switch]$IncludeMessages
)

$ErrorActionPreference = "Stop"
$Endpoint = $Endpoint.TrimEnd("/")

$headers = @{
  "X-Appwrite-Project" = $ProjectId
  "X-Appwrite-Key" = $ApiKey
  "Content-Type" = "application/json"
}

function Get-ErrorDetails {
  param([System.Management.Automation.ErrorRecord]$ErrorRecord)

  $response = $ErrorRecord.Exception.Response
  if (-not $response) {
    return [pscustomobject]@{
      StatusCode = $null
      Body = $ErrorRecord.Exception.Message
    }
  }

  $statusCode = [int]$response.StatusCode
  $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
  $body = $reader.ReadToEnd()
  $reader.Dispose()

  return [pscustomobject]@{
    StatusCode = $statusCode
    Body = $body
  }
}

function Invoke-Appwrite {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Method,

    [Parameter(Mandatory = $true)]
    [string]$Path,

    $Body = $null
  )

  $uri = "$Endpoint$Path"
  $params = @{
    Method = $Method
    Uri = $uri
    Headers = $headers
    ErrorAction = "Stop"
  }

  if ($null -ne $Body) {
    $params.Body = ($Body | ConvertTo-Json -Depth 20 -Compress)
  }

  try {
    return Invoke-RestMethod @params
  } catch {
    $details = Get-ErrorDetails $_
    throw "Appwrite API error [$Method $Path] status=$($details.StatusCode) body=$($details.Body)"
  }
}

function Get-AppwriteOrNull {
  param([string]$Path)

  try {
    return Invoke-Appwrite -Method "GET" -Path $Path
  } catch {
    $message = $_.Exception.Message
    if ($message -match "status=404") {
      return $null
    }

    throw
  }
}

function Ensure-Database {
  param(
    [string]$Id,
    [string]$Name
  )

  $existing = Get-AppwriteOrNull "/databases/$Id"
  if ($existing) {
    Write-Host "[Appwrite] Database already exists: $Id"
    return
  }

  Write-Host "[Appwrite] Creating database: $Id"
  Invoke-Appwrite -Method "POST" -Path "/databases" -Body @{
    databaseId = $Id
    name = $Name
    enabled = $true
  } | Out-Null
}

function Ensure-Collection {
  param(
    [string]$DatabaseId,
    [hashtable]$Spec
  )

  $collectionId = $Spec.collectionId
  $existing = Get-AppwriteOrNull "/databases/$DatabaseId/collections/$collectionId"
  if ($existing) {
    Write-Host "[Appwrite] Collection already exists: $collectionId"
    return
  }

  Write-Host "[Appwrite] Creating collection: $collectionId"
  Invoke-Appwrite -Method "POST" -Path "/databases/$DatabaseId/collections" -Body $Spec | Out-Null
}

$createPermission = 'create("users")'

$collections = @(
  @{
    collectionId = "user_profiles"
    name = "User Profiles"
    permissions = @($createPermission)
    documentSecurity = $true
    enabled = $true
    attributes = @(
      @{ key = "name"; type = "string"; size = 255; required = $true; array = $false; encrypt = $false },
      @{ key = "email"; type = "email"; required = $true; array = $false },
      @{ key = "plan"; type = "enum"; elements = @("starter", "plus", "pro"); required = $false; default = "starter"; array = $false },
      @{ key = "listeningMinutesRemaining"; type = "integer"; required = $false; default = 30; array = $false },
      @{ key = "aiResponsesRemaining"; type = "integer"; required = $false; default = 30; array = $false },
      @{ key = "creditsExpiresAt"; type = "datetime"; required = $false; array = $false },
      @{ key = "subscriptionExpiresAt"; type = "datetime"; required = $false; array = $false },
      @{ key = "isActive"; type = "boolean"; required = $false; default = $true; array = $false }
    )
    indexes = @(
      @{ key = "idx_user_profiles_email"; type = "unique"; attributes = @("email") }
    )
  },
  @{
    collectionId = "conversations"
    name = "Conversations"
    permissions = @($createPermission)
    documentSecurity = $true
    enabled = $true
    attributes = @(
      @{ key = "userId"; type = "string"; size = 64; required = $true; array = $false; encrypt = $false },
      @{ key = "title"; type = "string"; size = 512; required = $true; array = $false; encrypt = $false },
      @{ key = "createdAt"; type = "datetime"; required = $true; array = $false },
      @{ key = "updatedAt"; type = "datetime"; required = $true; array = $false }
    )
    indexes = @(
      @{ key = "idx_conversations_user_updated"; type = "key"; attributes = @("userId", "updatedAt"); orders = @("ASC", "DESC") }
    )
  },
  @{
    collectionId = "system_prompts"
    name = "System Prompts"
    permissions = @($createPermission)
    documentSecurity = $true
    enabled = $true
    attributes = @(
      @{ key = "userId"; type = "string"; size = 64; required = $true; array = $false; encrypt = $false },
      @{ key = "name"; type = "string"; size = 255; required = $true; array = $false; encrypt = $false },
      @{ key = "prompt"; type = "string"; size = 20000; required = $true; array = $false; encrypt = $false },
      @{ key = "createdAt"; type = "datetime"; required = $true; array = $false },
      @{ key = "updatedAt"; type = "datetime"; required = $true; array = $false }
    )
    indexes = @(
      @{ key = "idx_system_prompts_user_updated"; type = "key"; attributes = @("userId", "updatedAt"); orders = @("ASC", "DESC") }
    )
  },
  @{
    collectionId = "user_settings"
    name = "User Settings"
    permissions = @($createPermission)
    documentSecurity = $true
    enabled = $true
    attributes = @(
      @{ key = "selectedModel"; type = "string"; size = 128; required = $false; default = "openrouter/auto"; array = $false; encrypt = $false },
      @{ key = "responseLength"; type = "string"; size = 32; required = $false; default = "auto"; array = $false; encrypt = $false },
      @{ key = "language"; type = "string"; size = 64; required = $false; default = "English"; array = $false; encrypt = $false },
      @{ key = "systemPrompt"; type = "string"; size = 20000; required = $false; default = ""; array = $false; encrypt = $false },
      @{ key = "providerMode"; type = "string"; size = 64; required = $false; default = "openrouter"; array = $false; encrypt = $false },
      @{ key = "apiKey"; type = "string"; size = 4096; required = $false; default = ""; array = $false; encrypt = $false }
    )
    indexes = @()
  }
)

if ($IncludeMessages) {
  $collections += @{
    collectionId = "messages"
    name = "Messages"
    permissions = @($createPermission)
    documentSecurity = $true
    enabled = $true
    attributes = @(
      @{ key = "userId"; type = "string"; size = 64; required = $true; array = $false; encrypt = $false },
      @{ key = "conversationId"; type = "string"; size = 64; required = $true; array = $false; encrypt = $false },
      @{ key = "role"; type = "enum"; elements = @("user", "assistant", "system"); required = $true; array = $false },
      @{ key = "content"; type = "string"; size = 50000; required = $true; array = $false; encrypt = $false },
      @{ key = "timestamp"; type = "datetime"; required = $true; array = $false },
      @{ key = "attachedFilesJson"; type = "string"; size = 20000; required = $false; default = ""; array = $false; encrypt = $false }
    )
    indexes = @(
      @{ key = "idx_messages_conversation_timestamp"; type = "key"; attributes = @("conversationId", "timestamp"); orders = @("ASC", "ASC") },
      @{ key = "idx_messages_user"; type = "key"; attributes = @("userId"); orders = @("ASC") }
    )
  }
}

Ensure-Database -Id $DatabaseId -Name $DatabaseName
    
foreach ($collection in $collections) {
  Ensure-Collection -DatabaseId $DatabaseId -Spec $collection
}

Write-Host ""
Write-Host "[Appwrite] Schema ready. Use these environment values:"
Write-Host "VITE_APPWRITE_ENDPOINT=$Endpoint"
Write-Host "VITE_APPWRITE_PROJECT_ID=$ProjectId"
Write-Host "VITE_APPWRITE_DATABASE_ID=$DatabaseId"
Write-Host "VITE_APPWRITE_COLLECTION_USER_PROFILES=user_profiles"
Write-Host "VITE_APPWRITE_COLLECTION_CONVERSATIONS=conversations"
Write-Host "VITE_APPWRITE_COLLECTION_SYSTEM_PROMPTS=system_prompts"
Write-Host "VITE_APPWRITE_COLLECTION_USER_SETTINGS=user_settings"
if ($IncludeMessages) {
  Write-Host "VITE_APPWRITE_COLLECTION_MESSAGES=messages"
}