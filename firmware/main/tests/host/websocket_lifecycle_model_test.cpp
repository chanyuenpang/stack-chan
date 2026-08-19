#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <iostream>
#include <mutex>
#include <thread>
#include <vector>

namespace {

// This is an executable lifecycle specification. The Python contract checks
// the production source shape, and the ESP-IDF build checks production code.
// Keeping this model platform-neutral makes the critical interleavings
// deterministic without pretending to substitute for either gate.

enum class Event {
    CallbackEntered,
    CallbackReturned,
    ExitPublished,
    JoinReturned,
    ResourceFreed,
    FirstWaitTimedOut,
};

class LifecycleModel {
public:
    void PassiveDisconnect()
    {
        std::unique_lock lock(mutex_);
        connected_ = false;
        socket_open_ = false;
        ++callback_count_;
        RecordLocked(Event::CallbackEntered);
        callback_entered_ = true;
        condition_.notify_all();
        WaitLocked(lock, [this] { return release_callback_; },
                   "timed out waiting to release passive callback");
        RecordLocked(Event::CallbackReturned);
        worker_exited_ = true;
        RecordLocked(Event::ExitPublished);
        condition_.notify_all();
    }

    void OwnerDestroy(bool inject_first_wait_timeout)
    {
        std::unique_lock lock(mutex_);
        owner_waiting_ = true;
        condition_.notify_all();
        if (inject_first_wait_timeout && !worker_exited_) {
            RecordLocked(Event::FirstWaitTimedOut);
            timeout_observed_ = true;
            condition_.notify_all();
        }
        WaitLocked(lock, [this] { return worker_exited_; },
                   "owner returned or stalled before worker exit");
        RecordLocked(Event::JoinReturned);
        resources_alive_ = false;
        RecordLocked(Event::ResourceFreed);
        destroy_done_ = true;
        condition_.notify_all();
    }

    void SelfRequestStop()
    {
        std::lock_guard lock(mutex_);
        if (connected_) {
            connected_ = false;
            ++callback_count_;
        }
        socket_open_ = false;
        condition_.notify_all();
    }

    void OwnerRequestActiveDisconnect()
    {
        std::lock_guard lock(mutex_);
        if (connected_) {
            connected_ = false;
            ++callback_count_;
        }
        socket_open_ = false;
        condition_.notify_all();
    }

    void PublishExit()
    {
        std::lock_guard lock(mutex_);
        worker_exited_ = true;
        RecordLocked(Event::ExitPublished);
        condition_.notify_all();
    }

    void WaitForCallbackAndOwner()
    {
        std::unique_lock lock(mutex_);
        WaitLocked(lock, [this] { return callback_entered_ && owner_waiting_; },
                   "passive callback/owner barrier was not reached");
    }

    void WaitForTimeoutObservation()
    {
        std::unique_lock lock(mutex_);
        WaitLocked(lock, [this] { return timeout_observed_; },
                   "first wait timeout was not observed");
    }

    void ReleaseCallback()
    {
        std::lock_guard lock(mutex_);
        release_callback_ = true;
        condition_.notify_all();
    }

    bool ResourcesAlive() const
    {
        std::lock_guard lock(mutex_);
        return resources_alive_;
    }

    bool DestroyDone() const
    {
        std::lock_guard lock(mutex_);
        return destroy_done_;
    }

    int CallbackCount() const
    {
        std::lock_guard lock(mutex_);
        return callback_count_;
    }

    std::vector<Event> Events() const
    {
        std::lock_guard lock(mutex_);
        return events_;
    }

private:
    template <typename Predicate>
    void WaitLocked(std::unique_lock<std::mutex>& lock, Predicate predicate,
                    const char* failure)
    {
        if (!condition_.wait_for(lock, std::chrono::seconds(2), predicate)) {
            std::cerr << failure << '\n';
            std::exit(1);
        }
    }

    void RecordLocked(Event event)
    {
        events_.push_back(event);
    }

    mutable std::mutex mutex_;
    std::condition_variable condition_;
    std::vector<Event> events_;
    bool connected_ = true;
    bool socket_open_ = true;
    bool callback_entered_ = false;
    bool release_callback_ = false;
    bool owner_waiting_ = false;
    bool worker_exited_ = false;
    bool resources_alive_ = true;
    bool destroy_done_ = false;
    bool timeout_observed_ = false;
    int callback_count_ = 0;
};

std::size_t Position(const std::vector<Event>& events, Event expected)
{
    for (std::size_t i = 0; i < events.size(); ++i) {
        if (events[i] == expected) {
            return i;
        }
    }
    std::cerr << "missing lifecycle event\n";
    std::exit(1);
}

void Require(bool condition, const char* message)
{
    if (!condition) {
        std::cerr << message << '\n';
        std::exit(1);
    }
}

void TestPassiveDisconnectBlocksOwnerFree()
{
    LifecycleModel model;
    std::thread receiver([&model] { model.PassiveDisconnect(); });
    std::thread owner([&model] { model.OwnerDestroy(false); });

    model.WaitForCallbackAndOwner();
    Require(model.ResourcesAlive(), "owner freed resources while callback was active");
    Require(!model.DestroyDone(), "owner teardown completed before receive task exit");
    model.ReleaseCallback();

    receiver.join();
    owner.join();
    const auto events = model.Events();
    Require(Position(events, Event::CallbackReturned) < Position(events, Event::ExitPublished),
            "exit published before callback returned");
    Require(Position(events, Event::ExitPublished) < Position(events, Event::JoinReturned),
            "join returned before exit publication");
    Require(Position(events, Event::JoinReturned) < Position(events, Event::ResourceFreed),
            "resources freed before join returned");
    Require(model.CallbackCount() == 1, "disconnect callback was not delivered exactly once");
}

void TestSelfStopDefersReclamationToOwner()
{
    LifecycleModel model;
    model.SelfRequestStop();
    Require(model.ResourcesAlive(), "self-stop reclaimed owner resources");
    Require(model.CallbackCount() == 1, "self-stop did not notify exactly once");
    model.PublishExit();
    model.OwnerDestroy(false);
    Require(!model.ResourcesAlive(), "external owner did not reclaim after exit");
    Require(model.CallbackCount() == 1, "owner duplicated self-stop notification");
}

void TestActiveDisconnectNotifiesOnceAndWaitsForExit()
{
    LifecycleModel model;
    model.OwnerRequestActiveDisconnect();
    model.OwnerRequestActiveDisconnect();
    Require(model.CallbackCount() == 1, "active disconnect notification was not exactly once");
    Require(model.ResourcesAlive(), "active disconnect reclaimed before worker exit");
    model.PublishExit();
    model.OwnerDestroy(false);
    Require(model.CallbackCount() == 1, "owner teardown duplicated active notification");
}

void TestFirstTimeoutRemainsFailClosed()
{
    LifecycleModel model;
    std::thread owner([&model] { model.OwnerDestroy(true); });
    model.WaitForTimeoutObservation();
    Require(model.ResourcesAlive(), "timeout path freed live worker resources");
    Require(!model.DestroyDone(), "timeout path returned before worker exit");
    model.PublishExit();
    owner.join();
    const auto events = model.Events();
    Require(Position(events, Event::FirstWaitTimedOut) < Position(events, Event::ExitPublished),
            "timeout injection did not precede exit");
    Require(Position(events, Event::ExitPublished) < Position(events, Event::ResourceFreed),
            "timeout path freed resources before eventual exit");
}

}  // namespace

int main()
{
    TestPassiveDisconnectBlocksOwnerFree();
    TestSelfStopDefersReclamationToOwner();
    TestActiveDisconnectNotifiesOnceAndWaitsForExit();
    TestFirstTimeoutRemainsFailClosed();
    std::cout << "websocket lifecycle model: ok\n";
    return 0;
}
