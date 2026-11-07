package com.example.todo.exception;

import java.time.Instant;
import java.util.Map;

public class ApiErrorResponse {

    private int status;
    private String error;
    private String message;
    private String path;
    private String servedBy;
    private Instant timestamp;
    private Map<String, String> validationErrors;

    public ApiErrorResponse(int status, String error, String message, String path, String servedBy) {
        this.status = status;
        this.error = error;
        this.message = message;
        this.path = path;
        this.servedBy = servedBy;
        this.timestamp = Instant.now();
    }

    public int getStatus() {
        return status;
    }

    public void setStatus(int status) {
        this.status = status;
    }

    public String getError() {
        return error;
    }

    public void setError(String error) {
        this.error = error;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public String getPath() {
        return path;
    }

    public void setPath(String path) {
        this.path = path;
    }

    public String getServedBy() {
        return servedBy;
    }

    public void setServedBy(String servedBy) {
        this.servedBy = servedBy;
    }

    public Instant getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(Instant timestamp) {
        this.timestamp = timestamp;
    }

    public Map<String, String> getValidationErrors() {
        return validationErrors;
    }

    public void setValidationErrors(Map<String, String> validationErrors) {
        this.validationErrors = validationErrors;
    }
}

