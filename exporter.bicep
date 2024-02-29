@allowed([
  'koreacentral'
])
param location string

resource containerGroup 'Microsoft.ContainerInstance/containerGroups@2019-12-01' = {
  name: 'telemetry-scrapper'
  location: location

  properties: {
    containers: [
      {
        name: 'telemetry-scrapper'
        properties: {
          image: 'gluwa/creditcoin-telemetry-exporter:0.0.3'
          resources: {
            requests: {
              cpu: 2
              memoryInGB: 2
            }
          }
          ports: [
            {
              protocol: 'TCP'
              port: 8080
            }
          ]
        }
      }
    ]
    restartPolicy: 'OnFailure'
    osType: 'Linux'
    ipAddress: {
      type: 'Public'
      dnsNameLabel: 'telemetry-scrapper'
      ports: [
        {
          protocol: 'TCP'
          port: 8080
        }
      ]
    }
  }
}
