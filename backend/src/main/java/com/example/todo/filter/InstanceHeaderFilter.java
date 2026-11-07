package com.example.todo.filter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.net.InetAddress;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class InstanceHeaderFilter extends OncePerRequestFilter {

    private final String instanceIdentifier;

    public InstanceHeaderFilter(@Value("${app.instance-id:}") String configuredInstanceId) {
        String resolved = configuredInstanceId;
        if (resolved == null || resolved.isBlank() || "backend-local".equals(resolved)) {
            try {
                resolved = InetAddress.getLocalHost().getHostName();
            } catch (Exception e) {
                resolved = "todo-backend-unknown";
            }
        }
        this.instanceIdentifier = resolved;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        response.setHeader("X-Served-By", instanceIdentifier);
        filterChain.doFilter(request, response);
    }

    public String getInstanceIdentifier() {
        return instanceIdentifier;
    }
}

