package com.example.todo.dto;

import com.example.todo.entity.TodoList;
import java.time.Instant;

public class TodoListResponse {

    private Long id;
    private String name;
    private String color;
    private long taskCount;
    private Instant createdAt;

    public TodoListResponse() {
    }

    public TodoListResponse(Long id, String name, String color, long taskCount, Instant createdAt) {
        this.id = id;
        this.name = name;
        this.color = color;
        this.taskCount = taskCount;
        this.createdAt = createdAt;
    }

    public static TodoListResponse fromEntity(TodoList list, long taskCount) {
        return new TodoListResponse(
                list.getId(),
                list.getName(),
                list.getColor(),
                taskCount,
                list.getCreatedAt()
        );
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
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

    public long getTaskCount() {
        return taskCount;
    }

    public void setTaskCount(long taskCount) {
        this.taskCount = taskCount;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}

