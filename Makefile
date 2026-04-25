CXX = g++
CXXFLAGS = -std=c++17 -Wall -Wextra -O2
LDFLAGS = -lsqlite3

TARGET = chopsticks
SRCS = main.cpp chopsticks.cpp
OBJS = $(SRCS:.cpp=.o)

EXPORT_TARGET = export_strategy
EXPORT_SRCS = export_strategy.cpp chopsticks.cpp
EXPORT_OBJS = export_strategy.o chopsticks.o

.PHONY: all clean run run-default run-rollover run-death-attack run-both generate

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CXX) $(CXXFLAGS) -o $@ $^ $(LDFLAGS)

$(EXPORT_TARGET): $(EXPORT_OBJS)
	$(CXX) $(CXXFLAGS) -o $@ $^ $(LDFLAGS)

export_strategy.o: export_strategy.cpp chopsticks.hpp
	$(CXX) $(CXXFLAGS) -c -o $@ $<

%.o: %.cpp chopsticks.hpp
	$(CXX) $(CXXFLAGS) -c -o $@ $<

clean:
	rm -f $(TARGET) $(EXPORT_TARGET) $(OBJS) $(EXPORT_OBJS) *.db

generate: $(EXPORT_TARGET)
	mkdir -p web/src/lib/generated
	./$(EXPORT_TARGET) web/src/lib/generated/strategy.ts

# Four orthogonal rule modes (rollover x death_attack):
run run-default: $(TARGET)
	./$(TARGET) --no-db

run-rollover: $(TARGET)
	./$(TARGET) --no-db --rollover

run-death-attack: $(TARGET)
	./$(TARGET) --no-db --death-attack

run-both: $(TARGET)
	./$(TARGET) --no-db --rollover --death-attack
