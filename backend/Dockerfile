# Stage 1: Build stage with Maven and JDK 17
FROM maven:3.9.6-eclipse-temurin-17-alpine AS builder
WORKDIR /build

# Cache dependencies first
COPY pom.xml .
RUN mvn dependency:go-offline -B

# Copy source and build fat JAR
COPY src ./src
RUN mvn clean package -DskipTests -B

# Stage 2: Minimal production runtime with JRE 17
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app

# Install curl for Docker container healthchecks
RUN apk add --no-cache curl

# Run as non-root user for container security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

COPY --from=builder /build/target/*.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-XX:+UseContainerSupport", "-XX:MaxRAMPercentage=75.0", "-jar", "app.jar"]

