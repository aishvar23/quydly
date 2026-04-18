# setup-dlq-alerts.ps1
# Creates Azure Monitor alerts for scrape-queue and synthesize-queue dead-letter queues.
# Sends email to aishvar.suhane@gmail.com when DLQ message count > 0.
# Run once before Phase 9 (parallel scraping).

$resourceGroup = "quydly-pipeline-rg"
$namespace = "quydly-pipeline"
$email = "aishvar.suhane@gmail.com"
$actionGroup = "quydly-pipeline-email-ag"

Write-Host "Fetching subscription ID..."
$subId = az account show --query id -o tsv
$scope = "/subscriptions/$subId/resourceGroups/$resourceGroup/providers/Microsoft.ServiceBus/namespaces/$namespace"

# Step 1: Action group (shared by both alerts)
Write-Host "Creating action group..."
az monitor action-group create --name $actionGroup --resource-group $resourceGroup --short-name qp-email --action email dlq-alert $email

# Step 2: scrape-queue DLQ alert (8.1)
Write-Host "Creating scrape-queue DLQ alert..."
az monitor metrics alert create `
    --name "scrape-queue-dlq-alert" `
    --resource-group $resourceGroup `
    --scopes $scope `
    --condition "avg DeadletteredMessages > 0 where EntityName includes scrape-queue" `
    --window-size 5m `
    --evaluation-frequency 5m `
    --severity 2 `
    --description "scrape-queue has dead-lettered messages" `
    --action $actionGroup

# Step 3: synthesize-queue DLQ alert (8.2)
Write-Host "Creating synthesize-queue DLQ alert..."
az monitor metrics alert create `
    --name "synthesize-queue-dlq-alert" `
    --resource-group $resourceGroup `
    --scopes $scope `
    --condition "avg DeadletteredMessages > 0 where EntityName includes synthesize-queue" `
    --window-size 5m `
    --evaluation-frequency 5m `
    --severity 2 `
    --description "synthesize-queue has dead-lettered messages" `
    --action $actionGroup

Write-Host "Done. Both DLQ alerts created."
