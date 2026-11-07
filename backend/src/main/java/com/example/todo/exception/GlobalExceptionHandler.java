package com.example.todo.exception;

import io.github.resilience4j.circuitbreaker.CallNotPermittedException;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeoutException;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @Value("${app.instance-id:backend-local}")
    private String instanceId;

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ApiErrorResponse> handleNotFound(ResourceNotFoundException ex, HttpServletRequest request) {
        ApiErrorResponse error = new ApiErrorResponse(
                HttpStatus.NOT_FOUND.value(),
                "Not Found",
                ex.getMessage(),
                request.getRequestURI(),
                instanceId
        );
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(error);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiErrorResponse> handleValidation(MethodArgumentNotValidException ex, HttpServletRequest request) {
        Map<String, String> fieldErrors = new HashMap<>();
        for (FieldError fieldError : ex.getBindingResult().getFieldErrors()) {
            fieldErrors.put(fieldError.getField(), fieldError.getDefaultMessage());
        }

        ApiErrorResponse error = new ApiErrorResponse(
                HttpStatus.BAD_REQUEST.value(),
                "Validation Failed",
                "Input payload contains invalid fields",
                request.getRequestURI(),
                instanceId
        );
        error.setValidationErrors(fieldErrors);
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
    }

    @ExceptionHandler(CallNotPermittedException.class)
    public ResponseEntity<ApiErrorResponse> handleCircuitBreakerOpen(CallNotPermittedException ex, HttpServletRequest request) {
        log.warn("Circuit breaker open on instance {}: {}", instanceId, ex.getMessage());
        ApiErrorResponse error = new ApiErrorResponse(
                HttpStatus.SERVICE_UNAVAILABLE.value(),
                "Service Unavailable (Circuit Breaker Open)",
                "Database circuit breaker is currently open to prevent cascading failures. Please retry shortly.",
                request.getRequestURI(),
                instanceId
        );
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(error);
    }

    @ExceptionHandler(TimeoutException.class)
    public ResponseEntity<ApiErrorResponse> handleTimeout(TimeoutException ex, HttpServletRequest request) {
        log.error("Database operation timed out on instance {}: {}", instanceId, ex.getMessage());
        ApiErrorResponse error = new ApiErrorResponse(
                HttpStatus.GATEWAY_TIMEOUT.value(),
                "Gateway Timeout (TimeLimiter)",
                "Database operation exceeded the maximum allowed execution time.",
                request.getRequestURI(),
                instanceId
        );
        return ResponseEntity.status(HttpStatus.GATEWAY_TIMEOUT).body(error);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiErrorResponse> handleGeneralException(Exception ex, HttpServletRequest request) {
        if (ex.getCause() instanceof TimeoutException timeoutEx) {
            return handleTimeout(timeoutEx, request);
        }
        log.error("Unhandled exception on instance {}", instanceId, ex);
        ApiErrorResponse error = new ApiErrorResponse(
                HttpStatus.INTERNAL_SERVER_ERROR.value(),
                "Internal Server Error",
                ex.getMessage() != null ? ex.getMessage() : "An unexpected error occurred",
                request.getRequestURI(),
                instanceId
        );
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error);
    }
}
