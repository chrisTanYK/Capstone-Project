import {
  FraudDetectorClient,
  GetEventPredictionCommand,
} from "@aws-sdk/client-frauddetector";
import {
  SNSClient,
  PublishCommand,
} from "@aws-sdk/client-sns";
import {
  DynamoDBClient,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";

const fraudClient = new FraudDetectorClient({ region: REGION });
const snsClient = new SNSClient({ region: REGION });
const ddbClient = new DynamoDBClient({ region: REGION });

// Hardcoded SNS Topic ARN (replace with your actual SNS topic ARN)
const HARD_CODED_SNS_TOPIC_ARN = "arn:aws:sns:us-east-1:123456789012:HighRiskAlertsTopic-v3";

const FRAUD_EVENTS_TABLE = process.env.FRAUD_EVENTS_TABLE;

if (!FRAUD_EVENTS_TABLE) {
  console.error("Missing required environment variable: FRAUD_EVENTS_TABLE");
  throw new Error("Missing required environment variables");
}

console.log("Using hardcoded SNS Topic ARN:", HARD_CODED_SNS_TOPIC_ARN);
console.log("Using DynamoDB Table:", FRAUD_EVENTS_TABLE);

export const handler = async (event) => {
  try {
    console.log("Received event:", JSON.stringify(event));

    const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    console.log("Parsed body:", body);

    const requiredFields = ["eventId", "ip_address", "email_address"];
    const missingFields = requiredFields.filter((field) => !body[field]);

    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(", ")}`);
    }

    const { eventId, ip_address, email_address } = body;
    const timestamp = new Date().toISOString();

    // Call Fraud Detector
    const fraudCommand = new GetEventPredictionCommand({
      detectorId: "group3_fraud_detector",
      detectorVersionId: "1",
      eventId,
      eventTypeName: "new_registration",
      eventTimestamp: timestamp,
      entities: [{ entityType: "customer", entityId: eventId }],
      eventVariables: { ip_address, email_address },
    });

    const fraudResponse = await fraudClient.send(fraudCommand);
    console.log("Fraud Detector response:", JSON.stringify(fraudResponse));

    const allOutcomes = [];
    if (fraudResponse.ruleResults && Array.isArray(fraudResponse.ruleResults)) {
      for (const ruleResult of fraudResponse.ruleResults) {
        console.log("Rule result:", JSON.stringify(ruleResult));
        if (ruleResult.outcomes && Array.isArray(ruleResult.outcomes)) {
          allOutcomes.push(...ruleResult.outcomes);
        }
      }
    }

    const outcome = allOutcomes.length > 0 ? allOutcomes[0] : "No outcome";
    console.log("All fraud outcomes:", allOutcomes);

    const normalizedOutcomes = allOutcomes.map((o) =>
      o.trim().toLowerCase().replace(/\s+/g, "_")
    );
    console.log("Normalized outcomes:", normalizedOutcomes);

    const highRiskKeywords = [
      "high_risk_customer",
      "high_risk",
      "highrisk",
      "fraudulent",
      "fraud",
      "suspicious",
      "suspected",
      "review",
    ];
    console.log("High risk keywords:", highRiskKeywords);

    const isHighRisk = normalizedOutcomes.some((outcomeStr) =>
      highRiskKeywords.some((keyword) => outcomeStr.includes(keyword))
    );
    console.log("Is high risk from outcomes?:", isHighRisk);

    if (isHighRisk) {
      console.log("High risk detected — publishing SNS alert...");

      const message = `⚠️ High Risk Fraud Detected\nEvent ID: ${eventId}\nEmail: ${email_address}\nIP: ${ip_address}\nOutcome(s): ${allOutcomes.join(", ")}`;

      const publishCommand = new PublishCommand({
        TopicArn: HARD_CODED_SNS_TOPIC_ARN,
        Subject: "🚨 Fraud Detection Alert - High Risk",
        Message: message,
      });

      try {
        const snsResponse = await snsClient.send(publishCommand);
        console.log("SNS publish success:", snsResponse.MessageId || snsResponse);
      } catch (snsErr) {
        console.error("SNS publish failed:", snsErr);
      }
    } else {
      console.log("Outcome not high risk — no SNS publish.");
    }

    // Log event and outcome to DynamoDB
    const putCommand = new PutItemCommand({
      TableName: FRAUD_EVENTS_TABLE,
      Item: {
        eventId: { S: eventId },
        ip_address: { S: ip_address },
        email_address: { S: email_address },
        outcome: { S: outcome },
        timestamp: { S: timestamp },
      },
    });

    await ddbClient.send(putCommand);
    console.log("DynamoDB log entry created successfully");

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Fraud check completed.",
        outcome,
        details: fraudResponse,
      }),
    };
  } catch (err) {
    console.error("Error during Lambda execution:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error during prediction",
        error: err.message,
      }),
    };
  }
};
