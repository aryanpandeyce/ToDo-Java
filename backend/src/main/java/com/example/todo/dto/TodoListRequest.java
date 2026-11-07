package com.example.todo.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public class TodoListRequest {

    @NotBlank(message = "List name is required")
    @Size(max = 100, message = "List name must not exceed 100 characters")
    private String name;

    @Size(max = 32, message = "Color must not exceed 32 characters")
    private String color = "#6366f1";

    public TodoListRequest() {
    }

    public TodoListRequest(String name, String color) {
        this.name = name;
        this.color = color;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getColor() {
        return color;
    }

    public void setColor(String color) {
        this.color = color;
    }
}

