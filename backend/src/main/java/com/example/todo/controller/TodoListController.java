package com.example.todo.controller;

import com.example.todo.dto.TodoListRequest;
import com.example.todo.dto.TodoListResponse;
import com.example.todo.service.TodoService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/lists")
public class TodoListController {

    private final TodoService todoService;

    public TodoListController(TodoService todoService) {
        this.todoService = todoService;
    }

    @GetMapping
    public ResponseEntity<List<TodoListResponse>> getAllLists() {
        return ResponseEntity.ok(todoService.getAllLists());
    }

    @PostMapping
    public ResponseEntity<TodoListResponse> createList(@Valid @RequestBody TodoListRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(todoService.createList(request));
    }

    @PutMapping("/{id}")
    public ResponseEntity<TodoListResponse> updateList(
            @PathVariable Long id,
            @Valid @RequestBody TodoListRequest request) {
        return ResponseEntity.ok(todoService.updateList(id, request));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteList(@PathVariable Long id) {
        todoService.deleteList(id);
        return ResponseEntity.noContent().build();
    }
}

