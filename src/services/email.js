const nodemailer = require("nodemailer");
const handlebars = require("handlebars");
const fs = require("fs");
const path = require("path");

class EmailService {
  constructor(config) {
    this.config = config;
    this.transporter = null;
    this.template = null;
  }

  async init() {
    // Create transporter
    this.transporter = nodemailer.createTransport({
      host: this.config.smtp.host,
      port: this.config.smtp.port,
      secure: this.config.smtp.port === 465, // true for 465, false for other ports
      auth: {
        user: this.config.smtp.user,
        pass: this.config.smtp.password,
      },
    });

    // Register Handlebars helpers
    handlebars.registerHelper("eq", function (a, b) {
      return a === b;
    });

    // Load and compile email template
    const templatePath = path.join(__dirname, "../templates/email.hbs");
    const templateSource = fs.readFileSync(templatePath, "utf8");
    this.template = handlebars.compile(templateSource);
  }

  async generateEmailContent(services, logs = []) {
    if (!this.template) {
      throw new Error("Email service not initialized");
    }

    // Determine worst state (nak > nok > ok)
    const worstState = this.getWorstState(services);

    // Prepare template data
    const templateData = {
      subject: `[${worstState.toUpperCase()}] ${this.config.subject}`,
      timestamp: new Date().toISOString(),
      services: services.map((service) => ({
        name: service.name,
        state: service.state,
        lastUpdated: new Date(service.last_updated).toISOString(),
      })),
      logs: logs.map((log) => ({
        serviceName: log.service_name || "Unknown",
        state: log.state,
        timestamp: new Date(log.timestamp).toISOString(),
        logs: log.logs,
      })),
      hasLogs: logs.length > 0,
      worstState: worstState.toUpperCase(),
    };

    // Generate HTML content
    const html = this.template(templateData);
    return html;
  }

  async sendStatusEmail(services, logs = []) {
    if (!this.transporter || !this.template) {
      throw new Error("Email service not initialized");
    }

    // Determine worst state (nak > nok > ok)
    const worstState = this.getWorstState(services);

    // Prepare template data
    const templateData = {
      subject: `[${worstState.toUpperCase()}] ${this.config.subject}`,
      timestamp: new Date().toISOString(),
      services: services.map((service) => ({
        name: service.name,
        state: service.state,
        lastUpdated: new Date(service.last_updated).toISOString(),
      })),
      logs: logs.map((log) => ({
        serviceName: log.service_name || "Unknown",
        state: log.state,
        timestamp: new Date(log.timestamp).toISOString(),
        logs: log.logs,
      })),
      hasLogs: logs.length > 0,
      worstState: worstState.toUpperCase(),
    };

    // Generate HTML content
    const html = this.template(templateData);

    // Send email
    const mailOptions = {
      from: this.config.from,
      to: this.config.to,
      subject: templateData.subject,
      html: html,
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log("Email sent successfully:", info.messageId);
      return info;
    } catch (error) {
      console.error("Failed to send email:", error);
      throw error;
    }
  }

  getWorstState(services) {
    if (!services || services.length === 0) {
      return "nak";
    }

    const states = services.map((s) => s.state);

    if (states.includes("nak")) {
      return "nak";
    } else if (states.includes("nok")) {
      return "nok";
    } else {
      return "ok";
    }
  }

  async testConnection() {
    if (!this.transporter) {
      throw new Error("Email service not initialized");
    }

    try {
      await this.transporter.verify();
      console.log("SMTP connection verified successfully");
      return true;
    } catch (error) {
      console.error("SMTP connection failed:", error);
      throw error;
    }
  }
}

module.exports = EmailService;
