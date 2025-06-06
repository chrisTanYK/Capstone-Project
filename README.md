# Fraud Detection Application

AWS Serverless fraud detection application using AWS Fraud Detector, Lambda, SNS, and DynamoDB.

## Setup
1. Install dependencies: `npm install` in hello-world directory
2. Deploy: `sam deploy --guided`
3. Test: `curl -X POST [API_URL]/predict -d '{"eventId":"test","ip_address":"1.2.3.4","email_address":"test@example.com"}'`

## Architecture
- Lambda function processes fraud detection requests
- SNS sends alerts for high-risk events
- DynamoDB stores all fraud events
- API Gateway provides REST endpoint